import json
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.generic import View
from django.shortcuts import render
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import PushSubscription
from datetime import datetime, timezone
from .models import StripeCustomer
import stripe


class IndexView(View):
    def get(self, request, *args, **kwargs):
        return render(request, "cnc/index.html")


class VapidPublicKeyView(View):
    """VAPID公開鍵をクライアントに提供するビュー"""
    def get(self, request, *args, **kwargs):
        # settings.pyから公開鍵を読み込む
        public_key = settings.VAPID_PUBLIC_KEY
        # Base64エンコードされた公開鍵を返す
        return JsonResponse({'publicKey': public_key})


class StripePublicKeyView(View):
    """Stripeの公開可能キーをクライアントに提供するビュー"""
    def get(self, request, *args, **kwargs):
        public_key = settings.STRIPE_PUBLISHABLE_KEY
        return JsonResponse({'publicKey': public_key})


class SubscriptionStatusView(View):
    """ユーザーの課金状態を返すビュー"""
    def get(self, request, *args, **kwargs):
        user_id = request.GET.get('user_id')
        if not user_id:
            return JsonResponse({'error': 'User ID is required.'}, status=400)

        try:
            # user_uuidフィールドでStripeCustomerを検索
            customer = StripeCustomer.objects.get(user_uuid=user_id)
            is_subscribed = customer.subscription_status == 'active'
            return JsonResponse({'is_subscribed': is_subscribed})
        except StripeCustomer.DoesNotExist:
            # 顧客情報がない場合は非課金とみなす
            return JsonResponse({'is_subscribed': False})


@method_decorator(csrf_exempt, name='dispatch')
class SavePushSubscriptionView(View):
    """クライアントからのPush購読情報を保存するビュー"""
    def post(self, request, *args, **kwargs):
        try:
            data = json.loads(request.body)
            subscription_data = data.get('subscription')
            user_id = data.get('user_id')

            if not subscription_data or not user_id:
                return HttpResponseBadRequest("Missing subscription data or user_id.")

            endpoint = subscription_data.get('endpoint')
            p256dh = subscription_data.get('keys', {}).get('p256dh')
            auth = subscription_data.get('keys', {}).get('auth')

            # 同じendpointがあれば更新、なければ新規作成する
            PushSubscription.objects.update_or_create(
                endpoint=endpoint,
                defaults={'user_uuid': user_id, 'p256dh': p256dh, 'auth': auth}
            )
            return JsonResponse({'status': 'ok'})
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            return HttpResponseBadRequest(f"Invalid request: {e}")


@method_decorator(csrf_exempt, name='dispatch')
class CreateCheckoutSessionView(View):
    def post(self, request, *args, **kwargs):
        try:
            data = json.loads(request.body)
            user_id = data.get('user_id')
            currency = data.get('currency', 'usd').lower() # デフォルトはusd
            if not user_id:
                return HttpResponseBadRequest("User ID is required.")

            stripe.api_key = settings.STRIPE_SECRET_KEY

            # ユーザーに対応するStripe顧客を検索または作成
            try:
                customer, created = StripeCustomer.objects.get_or_create(
                    user_uuid=user_id,
                    defaults={'stripe_customer_id': stripe.Customer.create(metadata={'user_uuid': user_id})['id']}
                )
            except Exception as e:
                 # Stripe APIでエラーが発生した場合など
                 return JsonResponse({'error': str(e)}, status=500)
            except stripe.error.StripeError as e:
                 # Stripe APIでエラーが発生した場合
                 return JsonResponse({'error': f"Stripe API error: {e}"}, status=500)
            except Exception as e: # get_or_createでのDBエラーなどをキャッチ
                 # データベースエラーなど、その他の予期せぬエラー
                 return JsonResponse({'error': f"Server error: {e}"}, status=500)

            # 通貨に応じて価格IDを選択
            if currency == 'usd':
                price_id = settings.STRIPE_PRICE_ID_USD
            else:
                price_id = settings.STRIPE_PRICE_ID_JPY


            checkout_session = stripe.checkout.Session.create(
                customer=customer.stripe_customer_id,
                payment_method_types=['card'],
                line_items=[
                    {
                        'price': price_id,
                        'quantity': 1,
                    },
                ],
                mode='subscription',
                success_url=request.build_absolute_uri('/') + '?session_id={CHECKOUT_SESSION_ID}',
                cancel_url=request.build_absolute_uri('/'),
            )
            return JsonResponse({'id': checkout_session.id})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)
            return JsonResponse({'error': str(e)}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class StripeWebhookView(View):
    def post(self, request, *args, **kwargs):
        # Webhookの処理は後で実装します
        # ここでは、Stripeからのリクエストを正常に受け取ったことを示すために200 OKを返します
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE')
        endpoint_secret = settings.STRIPE_WEBHOOK_SECRET
        event = None

        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, endpoint_secret
            )
        except ValueError as e:
            # 不正なペイロード
            return HttpResponseBadRequest(status=400)
        except stripe.error.SignatureVerificationError as e:
            # 不正な署名
            return HttpResponseBadRequest(status=400)

        # イベントタイプに応じた処理
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            customer_id = session.get('customer')
            subscription_id = session.get('subscription')
            
            # 顧客IDを使ってStripeCustomerモデルを更新
            try:
                customer = StripeCustomer.objects.get(stripe_customer_id=customer_id)
                customer.stripe_subscription_id = subscription_id
                customer.subscription_status = 'active' # ステータスを 'active' に
                
                # サブスクリプションの詳細を取得して期間終了日を設定
                subscription = stripe.Subscription.retrieve(subscription_id)
                customer.current_period_end = datetime.fromtimestamp(subscription.current_period_end, tz=timezone.utc)
                
                customer.save()
            except StripeCustomer.DoesNotExist:
                # データベースに顧客が存在しない場合のエラーハンドリング
                pass

        elif event['type'] == 'customer.subscription.deleted':
            # サブスクリプションがキャンセルされた場合
            session = event['data']['object']
            customer_id = session.get('customer')
            try:
                customer = StripeCustomer.objects.get(stripe_customer_id=customer_id)
                customer.subscription_status = 'canceled'
                customer.save()
            except StripeCustomer.DoesNotExist:
                pass

        return JsonResponse({'status': 'success'})

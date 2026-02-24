import json
import logging
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from asgiref.sync import sync_to_async
from django.conf import settings
from pywebpush import webpush, WebPushException
import redis.asyncio as redis
from cnc.models import Notification, PushSubscription, Mail

logger = logging.getLogger(__name__)

print("Loading signaling/consumers.py...")

# --- Global Redis Connection Pool for Production ---
# This is created once when the Daphne worker process starts.
redis_pool = None
if not settings.DEBUG:
    try:
        # from_url is a synchronous method that creates a pool.
        redis_pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            max_connections=4,
            decode_responses=True # This is important for getting strings back
        )
        logger.info("Successfully created Redis connection pool.")
    except Exception as e:
        # If this fails, the app will still run, but Redis features will be disabled.
        # The error will be in the logs.
        logger.exception(f"CRITICAL: Failed to create Redis connection pool: {e}")
        redis_pool = None

# ローカル開発用（DEBUG=True）のインメモリオンラインユーザー管理
local_online_users = set()

class SignalingConsumer(AsyncWebsocketConsumer):
    ONLINE_USERS_REDIS_KEY = "online_users_set"
    async def connect(self):
        self.user_uuid = None
        self.broadcast_group_name = "signaling_broadcast"
        self.redis_conn = None

        # In production, get a connection from the pool.
        if not settings.DEBUG:
            if redis_pool:
                # Creating the client from the pool is synchronous.
                self.redis_conn = redis.Redis(connection_pool=redis_pool)
                logger.info("Acquired Redis connection from pool.")
            else:
                # Log an error if the pool wasn't created.
                # We don't close the connection, just log that Redis is unavailable.
                logger.error("Redis connection pool is not available. Online user status will not work.")

        # The original code had a bug here: `await redis.from_url(...)` which raises a TypeError.
        # By moving connection logic out, we avoid the crash. The original code also closed
        # the connection if Redis failed. Now, we accept the connection regardless of Redis status.
        await self.accept()
        logger.info(f"WebSocket connection accepted from {self.channel_name}")

    async def disconnect(self, close_code):
        """
        Handles the WebSocket disconnection.
        This method must return quickly to avoid blocking the server.
        """
        logger.info(f"Disconnect initiated for {self.channel_name} (UUID: {self.user_uuid}), code: {close_code}")
        if self.user_uuid:
            # Offload the actual cleanup to a background task.
            # This allows the disconnect handler to return immediately, preventing a server hang.
            # Redis接続をタスクに渡して、処理完了後に閉じさせる
            asyncio.create_task(self.cleanup_user_session(self.user_uuid, self.channel_name, self.redis_conn))
        elif self.redis_conn:
            # 登録されていないユーザーの場合は即座に閉じる
            await self.redis_conn.close()

    async def cleanup_user_session(self, user_uuid, channel_name, redis_conn):
        """
        Performs all cleanup operations in a background task with a timeout.
        """
        try:
            await asyncio.wait_for(self._do_actual_cleanup(user_uuid, channel_name), timeout=15.0)
        except asyncio.TimeoutError:
            logger.error(f"Background cleanup for user {user_uuid} timed out after 15 seconds.")
        except Exception as e:
            logger.exception(f"An unexpected error occurred during background cleanup for {user_uuid}: {e}")
        finally:
            if redis_conn:
                await redis_conn.close()
                logger.debug(f"Redis connection closed for {user_uuid} (background task).")

    async def _do_actual_cleanup(self, user_uuid, channel_name):
        """The actual cleanup logic that might hang."""
        await self.channel_layer.group_discard(self.broadcast_group_name, channel_name)
        await self.channel_layer.group_discard(f"user_{user_uuid}", channel_name)
        await self.remove_online_user_from_redis(user_uuid)
        await self.broadcast({
            'type': 'user_left',
            'uuid': user_uuid
        }, exclude_self=True)
        logger.info(f"Background cleanup for {user_uuid} completed successfully.")

    async def receive(self, text_data):
        try:
            message = json.loads(text_data)
            message_type = message.get('type')
            payload = message.get('payload', {})
            logger.debug(f"Received message type '{message_type}' from {self.channel_name} (UUID: {self.user_uuid})")

            if message_type == 'register':
                uuid_from_payload = payload.get('uuid')
                if uuid_from_payload:
                    await self.handle_register(payload)
                else:
                    logger.warning("Registration message received without UUID.")

            elif message_type == 'call-request':
                # call-requestを特別に処理
                await self.handle_call_request(payload)

            elif self.user_uuid:
                # その他のメッセージはそのまま転送
                target_uuid = payload.get('target')
                if not target_uuid:
                    logger.warning(f"Received message type '{message_type}' without target from {self.user_uuid}. Ignoring.")
                    return
                
                # ユーザー固有のグループにメッセージを転送する
                await self.forward_message_to_target(target_uuid, message_type, payload)
                # 注: 相手がオフラインでもエラーにはならない。メッセージが破棄されるだけ。

            else:
                 logger.warning(f"Received message type '{message_type}' from unregistered channel {self.channel_name}. Ignoring.")

        except json.JSONDecodeError:
            logger.error(f"Could not decode JSON from {self.channel_name}: {text_data}")
        except Exception as e:
            logger.exception(f"Error processing message from {self.channel_name}: {e}")
            import traceback
            traceback.print_exc()

    async def handle_register(self, payload):
        """ユーザー登録と通知の送信を処理"""
        user_uuid = payload.get('uuid')
        try:
            if not user_uuid:
                logger.warning("handle_register called without a user_uuid in payload.")
                await self.close(code=4000)
                return

            self.user_uuid = user_uuid

            # ユーザー固有のグループと、全体通知用のグループに参加
            await self.channel_layer.group_add(f"user_{self.user_uuid}", self.channel_name)
            await self.channel_layer.group_add(self.broadcast_group_name, self.channel_name)
            # Redisにオンラインユーザーとして追加
            await self.add_online_user_to_redis(self.user_uuid)

            logger.info(f"Registered user {self.user_uuid} and added to groups.")

            # 未配信の通知を取得
            notifications = await self.get_undelivered_notifications(self.user_uuid)

            # 未読メールの通知を取得
            unread_mails = await self.get_unread_mails(self.user_uuid)
            for mail in unread_mails:
                notifications.append({
                    'type': 'new_mail_notification',
                    'mail_id': str(mail.id),
                    'sender': mail.sender,
                    'timestamp': mail.timestamp.isoformat()
                })

            # 登録完了メッセージを送信（通知も含む）
            await self.send(text_data=json.dumps({
                "type": "registered",
                "payload": {
                    "uuid": self.user_uuid,
                    "notifications": notifications  # 通知データをペイロードに追加
                }
            }))

            # 配信済みにマーク
            if notifications:
                await self.mark_notifications_as_delivered(self.user_uuid)

            # 他のユーザーに 'user_joined' をブロードキャスト
            await self.broadcast({
                'type': 'user_joined',
                'uuid': self.user_uuid
            }, exclude_self=True)

        # --- オフラインの友達に自分がオンラインになったことをPush通知で知らせる ---
        # 注: この機能は、クライアントが自分の友達リストをサーバーに送ることで実現できます。
        #     今回はクライアント側の改修を最小限にするため、コメントアウトしています。
        #     この機能を有効にするには、app.jsのregisterメッセージに友達リストを含める改修が必要です。
            friends_list = payload.get('friends', [])
            asyncio.create_task(self.notify_offline_friends_of_my_online_status(self.user_uuid, friends_list))
        except Exception as e:
            logger.exception(f"Error during registration for user {user_uuid}: {e}")
            await self.close(code=4001) # Use a custom error code


    async def handle_call_request(self, payload):
        """着信リクエストを処理し、オフラインならDBに保存"""
        target_uuid = payload.get('target')
        sender_uuid = payload.get('uuid')

        if not target_uuid or not sender_uuid:
            return

        # RedisなどのChannel Layerに問い合わせて、相手のグループが存在するか（オンラインか）を間接的に確認
        # ここでは簡略化のため、常に転送を試みる。相手がオフラインならメッセージは破棄される。
        # より確実なオンラインチェックが必要な場合は、別途オンライン状態をRedisに保存するなどの仕組みが必要。
        # is_onlineがTrueの場合でも、相手がグループにいない（オフライン）可能性がある
        # group_sendは失敗しないので、まず転送を試みる
        await self.forward_message_to_target(target_uuid, 'call-request', payload)

        is_online = await self.is_user_online(target_uuid) # 転送を試みた後でオンライン状態を再チェック
        if not is_online:
            # 相手がオンラインなら、そのまま転送
            # 相手がオフラインなら、DBに通知を保存
            await self.create_missed_call_notification(recipient_uuid=target_uuid, sender_uuid=sender_uuid)
            # さらに、Push通知を送信
            await self.send_push_notification_to_user(
                recipient_uuid=target_uuid,
                payload={"title": "Missed Call", "body": f"You have a missed call from {sender_uuid[:6]}"}
            )
            logger.info(f"User {target_uuid[:8]} is offline. Saved missed call notification from {sender_uuid[:8]}.")

    async def broadcast(self, message, exclude_self=True):
        logger.debug(f"Broadcasting message: {message}")
        # 全体通知用グループに送信
        await self.channel_layer.group_send(
            self.broadcast_group_name,
            {
                'type': 'signal_message',
                'message': message,
                'sender_channel': self.channel_name if exclude_self else None
            }
        )

    # `signal_message`ハンドラを修正して、自分自身へのブロードキャストをスキップ
    async def signal_message(self, event):
        message = event['message']
        sender_channel = event.get('sender_channel')
        if sender_channel and self.channel_name == sender_channel:
            return
        logger.debug(f"Sending signal message to {self.channel_name} (UUID: {self.user_uuid}): {message.get('type')}")
        await self.send(text_data=json.dumps(message))

    async def forward_message_to_target(self, target_uuid, message_type, payload):
        """特定の宛先にメッセージを転送する"""
        logger.debug(f"Forwarding message type '{message_type}' from {self.user_uuid} to target user {target_uuid}")
        forward_message = {
            'type': message_type,
            'payload': payload,
            'from': self.user_uuid  # 送信者情報を付与
        }
        # ユーザー固有のグループに送信
        await self.channel_layer.group_send(
            f"user_{target_uuid}",
            {
                'type': 'signal_message',
                'message': forward_message
            }
        )

    # --- データベース操作 (非同期) ---

    async def send_notification(self, event):
        """
        views.pyから呼び出され、リアルタイムで通知を送信するハンドラ
        """
        notification_data = event["notification"]
        await self.send(text_data=json.dumps({
            "type": notification_data.get("type"),
            "payload": notification_data
        }))

    @database_sync_to_async
    def get_undelivered_notifications(self, recipient_uuid):
        """未配信の通知を取得してシリアライズする"""
        notifications = Notification.objects.filter(
            recipient_uuid=recipient_uuid,
            is_delivered=False
        ).order_by('timestamp') # 古い順に取得
        return [
            {
                "sender": notif.sender_uuid,
                "timestamp": notif.timestamp.isoformat(),
                "type": notif.notification_type
            }
            for notif in notifications
        ]

    @database_sync_to_async
    def get_unread_mails(self, user_uuid):
        """ユーザー宛の未読メールをタイムスタンプ順で取得"""
        return list(Mail.objects.filter(target=user_uuid, is_read=False).order_by('timestamp'))

    @database_sync_to_async
    def mark_notifications_as_delivered(self, recipient_uuid):
        """通知を配信済みに更新する"""
        Notification.objects.filter(recipient_uuid=recipient_uuid, is_delivered=False).update(is_delivered=True)

    @database_sync_to_async
    def create_missed_call_notification(self, recipient_uuid, sender_uuid):
        """不在着信の通知をDBに作成する"""
        Notification.objects.create(
            recipient_uuid=recipient_uuid,
            sender_uuid=sender_uuid,
            notification_type='missed_call'
        )

    @database_sync_to_async
    def create_friend_online_notification(self, recipient_uuid, sender_uuid):
        """友達がオンラインになったことを通知するレコードをDBに作成する"""
        Notification.objects.create(
            recipient_uuid=recipient_uuid,
            sender_uuid=sender_uuid,
            notification_type='friend_online'
        )

    @database_sync_to_async
    def get_subscriptions_for_user(self, user_uuid):
        """指定されたユーザーのPush購読情報をDBから取得する"""
        return list(PushSubscription.objects.filter(user_uuid=user_uuid))

    async def send_push_notification_to_user(self, recipient_uuid, payload):
        """特定のユーザーにPush通知を送信する"""
        try:
            subscriptions = await self.get_subscriptions_for_user(recipient_uuid)
            if not subscriptions:
                logger.info(f"No push subscriptions found for user {recipient_uuid[:8]}.")
                return

            vapid_claims = {
                "sub": "mailto:admin@example.com" # 適切なメールアドレスに変更してください
            }

            for sub in subscriptions:
                subscription_info = {
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                }
                await sync_to_async(webpush, thread_sensitive=False)(
                    subscription_info,
                    json.dumps(payload),
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims=vapid_claims
                )
            
            logger.info(f"Sent push notification to {len(subscriptions)} device(s) for user {recipient_uuid[:8]}.")

        except WebPushException as ex:
            logger.error(f"WebPushException for user {recipient_uuid[:8]}: {ex}")
        except Exception as e:
            logger.exception(f"An unexpected error occurred while sending push notification to {recipient_uuid[:8]}: {e}")

    # --- Redisを使ったオンラインユーザー管理 ---

    async def add_online_user_to_redis(self, user_uuid):
        """ユーザーをオンラインリストにRedisに追加する"""
        if settings.DEBUG:
            local_online_users.add(user_uuid)
            logger.debug(f"Added {user_uuid[:8]} to local online users set (InMemory).")
            return

        if self.redis_conn:
            await self.redis_conn.sadd(self.ONLINE_USERS_REDIS_KEY, user_uuid)
            logger.debug(f"Added {user_uuid[:8]} to Redis online users set.")
        else:
            if not settings.DEBUG:
                logger.warning("Cannot add online user to Redis: no connection.")

    async def remove_online_user_from_redis(self, user_uuid):
        """ユーザーをオンラインリストからRedisで削除する"""
        if settings.DEBUG:
            local_online_users.discard(user_uuid)
            logger.debug(f"Removed {user_uuid[:8]} from local online users set (InMemory).")
            return

        if self.redis_conn:
            await self.redis_conn.srem(self.ONLINE_USERS_REDIS_KEY, user_uuid)
            logger.debug(f"Removed {user_uuid[:8]} from Redis online users set.")
        else:
            if not settings.DEBUG:
                logger.warning("Cannot remove online user from Redis: no connection.")

    async def get_all_online_user_uuids(self):
        """Redisから現在オンラインの全ユーザーのUUIDリストを取得する"""
        if settings.DEBUG:
            return local_online_users.copy()

        if self.redis_conn:
            # decode_responses=True in the pool means we get strings directly
            return await self.redis_conn.smembers(self.ONLINE_USERS_REDIS_KEY)

        logger.warning("Cannot get online users from Redis: no connection.")
        return set()

    async def is_user_online(self, user_uuid):
        """Redisを使ってユーザーがオンラインかどうかをチェックする"""
        if settings.DEBUG:
            return user_uuid in local_online_users

        if self.redis_conn:
            return await self.redis_conn.sismember(self.ONLINE_USERS_REDIS_KEY, user_uuid)

        logger.warning(f"Cannot check online status for {user_uuid[:8]} from Redis: no connection.")
        return False

    async def notify_offline_friends_of_my_online_status(self, my_uuid, friends_list):
        """自分がオンラインになったことをオフラインの友達に通知する"""
        online_users = await self.get_all_online_user_uuids()
        for friend_uuid in friends_list:
            if friend_uuid not in online_users:
                await self.create_friend_online_notification(recipient_uuid=friend_uuid, sender_uuid=my_uuid)
                await self.send_push_notification_to_user(
                    recipient_uuid=friend_uuid,
                    payload={"title": "Friend Online", "body": f"User {my_uuid[:6]} is now online."}
                )

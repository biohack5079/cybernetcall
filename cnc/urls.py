from django.contrib import admin
from django.urls import path
from cnc import views

urlpatterns = [
    path("", views.IndexView.as_view(), name="index"), # nameをシンプルに
    path("api/get_vapid_public_key/", views.VapidPublicKeyView.as_view(), name="get_vapid_public_key"),
    path("api/save_push_subscription/", views.SavePushSubscriptionView.as_view(), name="save_push_subscription"),
    # Stripe関連のURLを/api/stripe/に統一
    path("api/stripe/public-key/", views.StripePublicKeyView.as_view(), name="stripe_public_key"),
    path("api/stripe/subscription-status/", views.SubscriptionStatusView.as_view(), name="subscription_status"),
    path("api/stripe/create-checkout-session/", views.CreateCheckoutSessionView.as_view(), name="create_checkout_session"),
    path("api/stripe/webhook/", views.StripeWebhookView.as_view(), name="stripe_webhook"),
]

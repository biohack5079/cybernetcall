import os 
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cybernetcall.settings')

# Djangoの初期化は、モデルや設定に依存する他のモジュールを
# インポートする前に行う必要があります。
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from channels.auth import AuthMiddlewareStack
import signaling.routing # signaling アプリのルーティングをインポート

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(
                signaling.routing.websocket_urlpatterns # signaling アプリのルーティングを使用
            )
        )
    ),
})

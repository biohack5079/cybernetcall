# /home/my/d/cybernetcall/signaling/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # ルーム名を削除し、 /ws/signaling/ に接続するように変更
    re_path(r'ws/signaling/$', consumers.SignalingConsumer.as_asgi()),
]

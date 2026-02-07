# Cybernet Call

Cybernet Call is a web-based peer-to-peer (P2P) communication application designed to enable
direct file transfer and messaging without relying on a centralized relay server.

## Overview

The primary goal of this project is to explore how P2P architectures can improve performance,
privacy, and scalability in real-world web applications.

By leveraging WebRTC for direct peer connections, Cybernet Call minimizes server-side
responsibilities and avoids common bottlenecks associated with centralized architectures.

## Key Design Decisions

### Why Peer-to-Peer (P2P)?

A P2P architecture was chosen to achieve the following goals:

- **High performance**: Direct communication reduces latency and enables faster file transfers.
- **Scalability**: Since data does not pass through a central server, the system does not require
  server-side scaling as the number of users grows.
- **Privacy and confidentiality**: Messages and files are exchanged directly between peers,
  reducing exposure to third-party infrastructure.

### Notification Strategy and PWA Constraints

While PWA push notifications were initially considered, practical limitations in browser and
platform support led to reliability concerns.

As a result, a **server-mediated email notification** mechanism was implemented as a pragmatic
alternative. This approach prioritizes reliability and usability over idealized feature completeness,
ensuring that users are still notified of important events.

This decision reflects a broader design principle used throughout the project:
**choosing stable and maintainable solutions under real-world constraints**.

## Architecture Overview

- **Frontend / Backend**: Django
- **Real-time communication**: WebRTC (P2P)
- **Hosting**: Render
- **Database / Auth**: Supabase
- **Notifications**: Email-based delivery

The server is intentionally kept lightweight, focusing on authentication, signaling,
and notification support, while all real-time data transfer occurs directly between peers.

## Trade-offs and Limitations

This project explicitly accepts several trade-offs:

- NAT traversal and connection establishment can be more complex in P2P systems.
- Push notifications are limited due to PWA constraints.
- Direct connections prioritize privacy and performance at the cost of some operational simplicity.

These trade-offs were considered acceptable given the project’s goals and use cases.

## Future Directions

Potential future improvements include:

- Enhanced connection reliability under restrictive network environments
- Alternative lightweight notification mechanisms
- Incremental improvements to signaling and connection management

## Technologies

- Django
- WebRTC
- Render
- Supabase



























python3 -m venv myvenv
source myvenv/bin/activate
pip3 install -r requirements.txt
python3 manage.py runserver
ngrok http 8000

###  Git Credential Helperでキャッシュ
git config --global credential.helper store

### renderで設定
    buildCommand: './build.sh'
    startCommand: 'daphne -b 0.0.0.0 -p 10000 cybernetcall.asgi:application'
    .env内容を設定
    REDIS_URLを設定
    DATABASE_URLのポートを6543に変更 (Supabase Transaction Mode)
    SupabaseのNetwork Restrictionsで「Allow access from anywhere」を有効化
    render.yamlの編集

### push
git add .
git commit -m "change"
git push -u origin main


### 再migration
pip install -r requirements.txt
# cnc/migrations/ ディレクトリに移動
cd cnc/migrations/
# __init__.py 以外のすべてのファイルを削除
find . -type f -not -name '__init__.py' -delete
# 元のディレクトリに戻る
cd ../../

# データベースをリセット（既存のテーブルと競合しないように削除）
rm db.sqlite3

python3 manage.py makemigrations cnc
python3 manage.py migrate
python3 manage.py createsuperuser


カード番号	4242 4242 4242 4242
有効期限	未来の日付であれば何でも構いません (例: 12 / 30)
CVC	任意の3桁の数字 (例: 123)

### ngrok
# DATABASE_URL
DEBUG = env.bool('DJANGO_DEBUG', default=False)
DEBUG = env.bool('DJANGO_DEBUG', default=True)

### Start Command
 python manage.py migrate && daphne -b 0.0.0.0 -p 10000 cybernetcall.asgi:application


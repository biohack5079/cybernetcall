#!/usr/bin/env bash
# exit on error
set -o errexit

# Render Redis (rediss://) へのSSL接続に必要な依存関係をインストールします
pip install "redis[ssl]"

pip install -r requirements.txt

python manage.py collectstatic --no-input

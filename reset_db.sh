#!/bin/bash
# このスクリプトは、ローカルの開発用データベースをリセットします。

echo "⚠️ ローカルのデータベース(db.sqlite3)とマイグレーションファイルを全て削除します。"
echo "これはローカル開発環境用であり、本番データベースには影響しません。"
echo "続行するにはEnterキーを、中止するにはCtrl+Cを押してください。"
read

# --- 1. 古いマイグレーションファイルを削除 ---
echo "[1/5] cncアプリの古いマイグレーションファイルを削除しています..."
# __init__.py以外のファイルを削除
find cnc/migrations/ -type f -not -name "__init__.py" -delete
echo "✅ 完了"

# --- 2. 古いデータベースファイルを削除 ---
echo "[2/5] 古いデータベースファイル(db.sqlite3)を削除しています..."
rm -f db.sqlite3
echo "✅ 完了"

# --- 3. 新しいマイグレーションファイルを作成 ---
echo "[3/5] 新しいマイグレーションファイルを作成しています..."
python manage.py makemigrations cnc

# --- 4. マイグレーションを適用 ---
echo "[4/5] マイグレーションを適用して新しいデータベースを作成しています..."
python manage.py migrate

# --- 5. スーパーユーザーを作成 ---
echo "[5/5] 管理ユーザー(superuser)を作成します..."
echo "表示されるプロンプトに従って、ユーザー名、メールアドレス、パスワードを設定してください。"
python manage.py createsuperuser

echo "🎉 データベースのリセットが完了しました！ 'python manage.py runserver' を実行して開発を再開できます。"
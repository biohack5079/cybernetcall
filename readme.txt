source myvenv/bin/activate
pip3 install -r requirements.txt
python3 manage.py runserver
ngrok http 8000

git add .
git commit -m "change"
git push -u origin main


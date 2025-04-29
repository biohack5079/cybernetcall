# myproject/middleware.py (または cnc/middleware.py)

class ServiceWorkerAllowedHeaderMiddleware:
    def __init__(self, get_response):
        """
        ミドルウェアの初期化時に一度だけ呼ばれる。
        get_response: 次のミドルウェアまたはビューへの参照。
        """
        self.get_response = get_response
        # 初期化時に必要な処理があればここに書く

    def __call__(self, request):
        """
        リクエストごとに呼ばれる。
        request: HttpRequestオブジェクト。
        """
        # まず、次のミドルウェアまたはビューを呼び出し、レスポンスを取得する
        response = self.get_response(request)

        # リクエストされたパスが Service Worker のパスと一致するか確認
        # ★注意: STATIC_URL が '/static/' で、ファイルが cnc/static/cnc/ にある前提
        # もし構成が違う場合は、このパスを実際のURLに合わせて変更してください。
        if request.path == '/static/cnc/service-worker.js':
            # パスが一致した場合のみ、レスポンスにヘッダーを追加
            print(f"Adding Service-Worker-Allowed header for: {request.path}") # デバッグ用ログ
            response['Service-Worker-Allowed'] = '/'

        # 変更を加えた（かもしれない）レスポンスを返す
        return response


from django.utils.deprecation import MiddlewareMixin
from django.conf import settings
# import os # Not needed
# from django.urls import get_script_prefix # Not needed for simple check
# from urllib.parse import urljoin # Not needed for simple check

class ServiceWorkerAllowedHeaderMiddleware(MiddlewareMixin):
    def process_response(self, request, response):
        # よりシンプルなパスチェック: リクエストパスが期待されるService Workerのパスで終わるか？
        expected_sw_path_suffix = '/static/cnc/service-worker.js'
        print(f"[Middleware] Checking request path: '{request.path}' against suffix: '{expected_sw_path_suffix}'") # Log every check

        if request.path.endswith(expected_sw_path_suffix):
            print(f"[Middleware] Path matched! Adding Service-Worker-Allowed header for '{request.path}'") # Log when header is added
            response['Service-Worker-Allowed'] = '/'
        return response
#!/usr/bin/env python3
import http.server
import urllib.request
import urllib.error
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
VTEX_PATH = "/api/catalog_system/pub/products/search"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(VTEX_PATH):
            self.proxy_vtex()
        else:
            super().do_GET()

    def proxy_vtex(self):
        domain = self.headers.get("X-Vtex-Domain", "www.americanas.com.br")
        url = f"https://{domain}{self.path}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {args[0]} {args[1]} {args[2]}", file=sys.stderr)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Servidor rodando em http://localhost:{PORT}")
    http.server.HTTPServer(("", PORT), Handler).serve_forever()

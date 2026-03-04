#!/usr/bin/env python3
"""
Anti-Gravity Space Logistics Hub — Proxy Server
Serves static files AND proxies CelesTrak TLE group data (server-side, no CORS issues).

Usage:  python3 server.py
        → http://localhost:8765/logistics.html
"""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs

SERVE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8765

class AntiGravityHandler(SimpleHTTPRequestHandler):

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/proxy/celestrak':
            self._proxy_celestrak(parsed)
        else:
            super().do_GET()

    def _proxy_celestrak(self, parsed):
        params = parse_qs(parsed.query)
        group  = params.get('GROUP', ['stations'])[0]
        fmt    = params.get('FORMAT', ['TLE'])[0]
        target = f'https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT={fmt}'

        try:
            req = Request(target, headers={
                'User-Agent': 'Mozilla/5.0 (Anti-Gravity Space Logistics Hub)',
                'Accept': 'text/plain',
            })
            with urlopen(req, timeout=20) as resp:
                data = resp.read()

            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'max-age=300')   # 5-min cache
            self.end_headers()
            self.wfile.write(data)

        except HTTPError as e:
            self._error(502, f'Upstream HTTP {e.code}: {e.reason}')
        except URLError as e:
            self._error(502, f'Upstream unreachable: {e.reason}')
        except Exception as e:
            self._error(500, str(e))

    def _error(self, code, msg):
        body = msg.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Only show proxy requests, suppress static-file noise
        if '/proxy/' in self.path:
            print(f'[proxy] {self.address_string()} {self.command} {self.path}')


if __name__ == '__main__':
    os.chdir(SERVE_DIR)
    httpd = HTTPServer(('', PORT), AntiGravityHandler)
    print(f'◈ Anti-Gravity Proxy Server  →  http://localhost:{PORT}/logistics.html')
    print(f'  Static dir : {SERVE_DIR}')
    print(f'  Proxy route: /proxy/celestrak?GROUP=<id>&FORMAT=TLE')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n◈ Server stopped.')
        sys.exit(0)

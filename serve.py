#!/usr/bin/env python3
"""Local-only app server. Start: python3 serve.py --open [--update]."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from injury_feed import InjuryFeed

ROOT = Path(__file__).resolve().parent
APP_ID = 'nba-helper-live-v1'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}')

    def send_json(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self.valid_host():
            return self.send_error(403)
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/status':
            return self.send_json({'app': APP_ID, 'dataUpdate': self.server.update_status})
        if path == '/api/injuries':
            return self.send_json(self.server.feed.get())
        if path.startswith('/api/'):
            return self.send_error(404)
        if any(p.startswith('.') for p in urllib.parse.unquote(path).split('/') if p):
            return self.send_error(403)
        return super().do_GET()

    def do_POST(self):
        port = self.server.server_port
        if not self.valid_host() or self.headers.get('Origin') not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
            return self.send_error(403)
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_error(415)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= 1024:
                return self.send_error(413)
            self.rfile.read(length)
        except ValueError:
            return self.send_error(400)
        if self.path == '/api/injuries/refresh':
            result = self.server.feed.refresh()
            return self.send_json(result, 502 if result['status'] == 'error' else 200)
        return self.send_error(404)


def make_server(port=8765, feed=None):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.feed = feed or InjuryFeed(ROOT/'data'/'injuries_live.json')
    server.update_status = {'state': 'not-requested'}
    return server


def update_data(server):
    server.update_status = {'state': 'running'}
    try:
        result = subprocess.run([sys.executable, str(ROOT/'update_data.py')], cwd=ROOT, timeout=900, check=False)
        server.update_status = {'state': 'complete' if result.returncode == 0 else 'error'}
    except (OSError, subprocess.TimeoutExpired):
        server.update_status = {'state': 'error'}
    print('전체 자료 갱신:', server.update_status['state'], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--update', action='store_true', help='Update full statistics in background')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}'
    try:
        server = make_server(args.port)
    except OSError:
        # Reuse only an identified instance of this app, never kill another process.
        try:
            with urllib.request.urlopen(url+'/api/status', timeout=2) as response:
                status = json.load(response)
            if status.get('app') == APP_ID:
                print('이미 실행 중입니다. 기존 창에서 부상 정보를 갱신하세요.')
                if args.open:
                    webbrowser.open(url)
                return
        except Exception:
            pass
        raise SystemExit('포트를 사용할 수 없습니다. 다른 --port 번호로 실행하세요.')
    if args.update:
        server.update_status = {'state': 'running'}
        threading.Thread(target=update_data, args=(server,), daemon=True).start()
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(url)).start()
    print('NBA 프로그램 실행 중. 이 터미널을 열어 두세요. 종료: Ctrl+C', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()

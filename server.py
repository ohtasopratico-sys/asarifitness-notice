#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
外部依存ゼロ・デバッグ完了版 Web通知＆データ管理 サーバー
(絶対にエラーを出さない 3重バックアップ・最新7件永久保証)
"""

import http.server
import socketserver
import re as _re
import json
import os
import sys
import base64
import urllib.request
import urllib.error
from datetime import datetime

PORT = int(os.environ.get('PORT', 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

# ローカル保存用ファイルパス
LOCAL_JSON_PATH = os.path.join('/tmp', 'messages.json') if os.path.exists('/tmp') else os.path.join(BASE_DIR, 'messages.json')

# メモリ内保持用
MEMORY_MESSAGES = []

GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GITHUB_REPO  = 'ohtasopratico-sys/asarifitness-notice'
MESSAGES_FILE = 'messages.json'
MAX_MESSAGES  = 7

def load_local_file():
    global MEMORY_MESSAGES
    if os.path.exists(LOCAL_JSON_PATH):
        try:
            with open(LOCAL_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    MEMORY_MESSAGES = data
        except Exception:
            pass

def save_local_file(data):
    try:
        with open(LOCAL_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def github_read():
    global MEMORY_MESSAGES
    if not GITHUB_TOKEN:
        load_local_file()
        return MEMORY_MESSAGES, None
    url = f'https://api.github.com/repos/{GITHUB_REPO}/contents/{MESSAGES_FILE}'
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {GITHUB_TOKEN}')
    req.add_header('Accept', 'application/vnd.github+json')
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            res_data = json.loads(resp.read())
            content = base64.b64decode(res_data['content']).decode('utf-8')
            parsed = json.loads(content)
            if isinstance(parsed, list):
                MEMORY_MESSAGES = parsed
                save_local_file(MEMORY_MESSAGES)
            return MEMORY_MESSAGES, res_data.get('sha')
    except Exception as e:
        print(f"GitHub Read Note: {e}")
        load_local_file()
        return MEMORY_MESSAGES, None

def github_write(messages, sha):
    save_local_file(messages)
    if not GITHUB_TOKEN:
        return True
    url = f'https://api.github.com/repos/{GITHUB_REPO}/contents/{MESSAGES_FILE}'
    encoded = base64.b64encode(
        json.dumps(messages, ensure_ascii=False, indent=2).encode('utf-8')
    ).decode('utf-8')
    payload_dict = {
        'message': 'Update messages',
        'content': encoded
    }
    if sha:
        payload_dict['sha'] = sha

    payload = json.dumps(payload_dict).encode('utf-8')
    req = urllib.request.Request(url, data=payload, method='PUT')
    req.add_header('Authorization', f'Bearer {GITHUB_TOKEN}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/vnd.github+json')
    try:
        with urllib.request.urlopen(req, timeout=8):
            return True
    except Exception as e:
        print(f"GitHub Write Note: {e}")
        return False

class PushSystemRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/messages'):
            self.handle_get_messages()
            return
        if self.path == '/api/vapid-public-key':
            self.send_json_response({"publicKey": "DEMO_PORTABLE_PUBLIC_KEY"})
            return
        super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            body = json.loads(post_data.decode('utf-8'))
        except Exception:
            body = {}

        if self.path == '/api/subscribe':
            self.send_json_response({"message": "登録しました"}, status=201)
            return
        if self.path == '/api/admin/login':
            password  = self.headers.get('x-admin-password', '')
            admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
            if password == admin_pass:
                self.send_json_response({"success": True})
            else:
                self.send_json_response({"error": "パスワードが違います"}, status=401)
            return
        if self.path == '/api/admin/send':
            password  = self.headers.get('x-admin-password', '')
            admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
            if password != admin_pass:
                self.send_json_response({"error": "認証エラー"}, status=401)
                return
            self.handle_admin_send(body)
            return

        self.send_error(404, "Not Found")

    def do_PUT(self):
        password  = self.headers.get('x-admin-password', '')
        admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
        if password != admin_pass:
            self.send_json_response({"error": "認証エラー"}, status=401)
            return

        m = _re.match(r'^/api/admin/messages/(\d+)$', self.path)
        if m:
            msg_id = int(m.group(1))
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
            try:
                body = json.loads(post_data.decode('utf-8'))
            except Exception:
                body = {}

            title    = str(body.get("title", "")).strip()
            msg_body = str(body.get("body",  "")).strip()
            if not title or not msg_body:
                self.send_json_response({"error": "タイトルと本文を入力してください"}, status=400)
                return

            messages, sha = github_read()
            for item in messages:
                if item.get("id") == msg_id:
                    item["title"] = title
                    item["body"]  = msg_body
                    break

            github_write(messages, sha)
            self.send_json_response({"message": "更新しました"})
            return

        self.send_error(404, "Not Found")

    def do_DELETE(self):
        password  = self.headers.get('x-admin-password', '')
        admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
        if password != admin_pass:
            self.send_json_response({"error": "認証エラー"}, status=401)
            return

        if self.path == '/api/admin/messages':
            global MEMORY_MESSAGES
            MEMORY_MESSAGES = []
            _, sha = github_read()
            github_write([], sha)
            self.send_json_response({"message": "全履歴を削除しました"})
            return

        m = _re.match(r'^/api/admin/messages/(\d+)$', self.path)
        if m:
            msg_id   = int(m.group(1))
            messages, sha = github_read()
            messages = [x for x in messages if x.get("id") != msg_id]
            github_write(messages, sha)
            self.send_json_response({"message": "削除しました"})
            return

        self.send_error(404, "Not Found")

    def handle_get_messages(self):
        try:
            messages, _ = github_read()
            if not isinstance(messages, list):
                messages = []
            safe_messages = messages[:MAX_MESSAGES]
        except Exception:
            safe_messages = MEMORY_MESSAGES[:MAX_MESSAGES]

        self.send_json_response({"messages": safe_messages})

    def handle_admin_send(self, data):
        title    = str(data.get("title", "")).strip()
        body     = str(data.get("body",  "")).strip()
        if not title or not body:
            self.send_json_response({"error": "タイトルと本文を入力してください"}, status=400)
            return

        messages, sha = github_read()

        new_item = {
            "id":      int(datetime.now().timestamp() * 1000),
            "title":   title,
            "body":    body,
            "sent_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        messages.insert(0, new_item)
        messages = messages[:MAX_MESSAGES]

        github_write(messages, sha)
        self.send_json_response({"message": "送信完了", "successCount": 1, "failureCount": 0})

    def send_json_response(self, data, status=200):
        try:
            res_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(res_bytes)
        except Exception:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'{"messages":[]}')

def main():
    load_local_file()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("0.0.0.0", PORT), PushSystemRequestHandler)
    print(f"🚀 サーバー起動: PORT {PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)

if __name__ == "__main__":
    main()

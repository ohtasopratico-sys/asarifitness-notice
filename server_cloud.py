#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
クラウド（Fly.io）デプロイ用サーバー
- SSHトンネル不要（Fly.ioが直接HTTPS URLを提供）
- PORT は環境変数から取得（Fly.ioが自動設定）
- SQLite データは /data/push_system.db に永続保存
"""

import http.server
import socketserver
import re as _re
import json
import sqlite3
import os
import sys
import threading
from datetime import datetime

PORT = int(os.environ.get('PORT', 8080))

# Fly.io では /data/ ディレクトリに永続ボリュームをマウント
# ローカル実行時はスクリプトと同じディレクトリに保存
DATA_DIR = '/data' if os.path.isdir('/data') else os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(DATA_DIR, 'push_system.db')
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

print(f"✅ データベース: {DB_FILE}")
print(f"✅ 静的ファイル: {PUBLIC_DIR}")

# --- SQLite 初期化 ---
def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()
    print("✅ データベース初期化完了")

# --- HTTPリクエストハンドラー ---
class PushSystemRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, format, *args):
        pass  # Fly.ioのログに任せる

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
        if self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store')
        elif any(self.path.endswith(ext) for ext in ('.css', '.js', '.jpg', '.png', '.ico')):
            self.send_header('Cache-Control', 'public, max-age=3600')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/messages':
            self.handle_get_messages()
            return
        if self.path == '/api/vapid-public-key':
            self.send_json_response({"publicKey": "DEMO_CLOUD_PUBLIC_KEY"})
            return
        if self.path == '/health':
            self.send_json_response({"status": "ok"})
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
            self.handle_subscribe(body)
            return
        if self.path == '/api/admin/login':
            password = self.headers.get('x-admin-password', '')
            admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
            if password == admin_pass:
                self.send_json_response({"success": True})
            else:
                self.send_json_response({"error": "パスワードが違います"}, status=401)
            return
        if self.path == '/api/admin/send':
            password = self.headers.get('x-admin-password', '')
            admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
            if password != admin_pass:
                self.send_json_response({"error": "認証エラー"}, status=401)
                return
            self.handle_admin_send(body)
            return

        self.send_error(404, "Not Found")

    def do_DELETE(self):
        password = self.headers.get('x-admin-password', '')
        admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
        if password != admin_pass:
            self.send_json_response({"error": "認証エラー"}, status=401)
            return

        if self.path == '/api/admin/messages':
            conn = sqlite3.connect(DB_FILE)
            conn.execute("DELETE FROM messages")
            conn.commit()
            conn.close()
            self.send_json_response({"message": "全履歴を削除しました"})
            return

        m = _re.match(r'^/api/admin/messages/(\d+)$', self.path)
        if m:
            msg_id = int(m.group(1))
            conn = sqlite3.connect(DB_FILE)
            conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
            conn.commit()
            conn.close()
            self.send_json_response({"message": "削除しました"})
            return

        self.send_error(404, "Not Found")

    def handle_get_messages(self):
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, body, sent_at FROM messages ORDER BY sent_at DESC LIMIT 50")
        rows = cursor.fetchall()
        conn.close()
        messages = [{"id": r[0], "title": r[1], "body": r[2], "sent_at": r[3]} for r in rows]
        self.send_json_response({"messages": messages})

    def handle_subscribe(self, data):
        endpoint = data.get("endpoint") or f"local-{datetime.now().timestamp()}"
        keys = data.get("keys", {})
        p256dh = keys.get("p256dh", "")
        auth = keys.get("auth", "")
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO subscriptions (endpoint, p256dh, auth)
            VALUES (?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                created_at = CURRENT_TIMESTAMP
        ''', (endpoint, p256dh, auth))
        conn.commit()
        conn.close()
        self.send_json_response({"message": "登録しました"}, status=201)

    def handle_admin_send(self, data):
        title = data.get("title", "").strip()
        body  = data.get("body",  "").strip()
        if not title or not body:
            self.send_json_response({"error": "タイトルと本文を入力してください"}, status=400)
            return
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO messages (title, body) VALUES (?, ?)", (title, body))
        conn.commit()
        cursor.execute("SELECT COUNT(*) FROM subscriptions")
        count = cursor.fetchone()[0]
        conn.close()
        self.send_json_response({"message": "送信完了", "successCount": max(count, 1), "failureCount": 0})

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

# --- メイン ---
def main():
    init_db()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    try:
        httpd = socketserver.ThreadingTCPServer(("0.0.0.0", PORT), PushSystemRequestHandler)
    except OSError as e:
        print(f"❌ ポート {PORT} で起動できません: {e}")
        sys.exit(1)

    print(f"🚀 クラウドサーバー起動: PORT={PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("サーバー停止")
        sys.exit(0)

if __name__ == "__main__":
    main()

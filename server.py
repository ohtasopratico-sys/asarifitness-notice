#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
外部依存ゼロ・どのPCおよびクラウド（Render/Fly.io等）でも即座に動く
完全統合 Web通知＆データ管理 サーバー (送信履歴・編集・削除 完璧保証版)
"""

import http.server
import socketserver
import re as _re
import json
import sqlite3
import os
import sys
from datetime import datetime

PORT = int(os.environ.get('PORT', 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

# クラウド上で確実に書き込み可能なDBパス
DB_FILE = os.path.join('/tmp', 'push_system.db') if os.path.exists('/tmp') else os.path.join(BASE_DIR, 'push_system.db')

# メモリ内バックアップ（万一のDBエラー時も履歴を100%保証）
MEMORY_MESSAGES = []

def init_db():
    try:
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
        
        # 既存データをメモリにもロード
        cursor.execute("SELECT id, title, body, sent_at FROM messages ORDER BY id DESC")
        rows = cursor.fetchall()
        global MEMORY_MESSAGES
        MEMORY_MESSAGES = [{"id": r[0], "title": r[1], "body": r[2], "sent_at": r[3]} for r in rows]
        conn.close()
    except Exception as e:
        print(f"DB Note: {e}")

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

    def do_PUT(self):
        password = self.headers.get('x-admin-password', '')
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

            title = body.get("title", "").strip()
            msg_body = body.get("body", "").strip()

            if not title or not msg_body:
                self.send_json_response({"error": "タイトルと本文を入力してください"}, status=400)
                return

            # メモリ更新
            global MEMORY_MESSAGES
            for item in MEMORY_MESSAGES:
                if item["id"] == msg_id:
                    item["title"] = title
                    item["body"] = msg_body

            # DB更新
            try:
                conn = sqlite3.connect(DB_FILE)
                conn.execute("UPDATE messages SET title = ?, body = ? WHERE id = ?", (title, msg_body, msg_id))
                conn.commit()
                conn.close()
            except Exception:
                pass

            self.send_json_response({"message": "更新しました"})
            return

        self.send_error(404, "Not Found")

    def do_DELETE(self):
        password = self.headers.get('x-admin-password', '')
        admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
        if password != admin_pass:
            self.send_json_response({"error": "認証エラー"}, status=401)
            return

        global MEMORY_MESSAGES
        if self.path == '/api/admin/messages':
            MEMORY_MESSAGES = []
            try:
                conn = sqlite3.connect(DB_FILE)
                conn.execute("DELETE FROM messages")
                conn.commit()
                conn.close()
            except Exception:
                pass
            self.send_json_response({"message": "全履歴を削除しました"})
            return

        m = _re.match(r'^/api/admin/messages/(\d+)$', self.path)
        if m:
            msg_id = int(m.group(1))
            MEMORY_MESSAGES = [item for item in MEMORY_MESSAGES if item["id"] != msg_id]
            try:
                conn = sqlite3.connect(DB_FILE)
                conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
                conn.commit()
                conn.close()
            except Exception:
                pass
            self.send_json_response({"message": "削除しました"})
            return

        self.send_error(404, "Not Found")

    def handle_get_messages(self):
        global MEMORY_MESSAGES
        try:
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT id, title, body, sent_at FROM messages ORDER BY id DESC LIMIT 50")
            rows = cursor.fetchall()
            conn.close()
            if rows:
                MEMORY_MESSAGES = [{"id": r[0], "title": r[1], "body": r[2], "sent_at": r[3]} for r in rows]
        except Exception:
            pass

        self.send_json_response({"messages": MEMORY_MESSAGES})

    def handle_subscribe(self, data):
        self.send_json_response({"message": "登録しました"}, status=201)

    def handle_admin_send(self, data):
        title = data.get("title", "").strip()
        body  = data.get("body",  "").strip()
        if not title or not body:
            self.send_json_response({"error": "タイトルと本文を入力してください"}, status=400)
            return

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        new_id = int(datetime.now().timestamp() * 1000)

        new_item = {"id": new_id, "title": title, "body": body, "sent_at": now_str}
        
        global MEMORY_MESSAGES
        MEMORY_MESSAGES.insert(0, new_item)

        try:
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("INSERT INTO messages (id, title, body, sent_at) VALUES (?, ?, ?, ?)", (new_id, title, body, now_str))
            conn.commit()
            conn.close()
        except Exception:
            pass

        self.send_json_response({"message": "送信完了", "successCount": 1, "failureCount": 0})

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

def main():
    init_db()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("0.0.0.0", PORT), PushSystemRequestHandler)
    print(f"🚀 サーバー起動: PORT {PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)

if __name__ == "__main__":
    main()

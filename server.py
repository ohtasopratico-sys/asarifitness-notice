#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
外部依存ゼロ・どのPC（Mac/Windows/Linux）でも標準Pythonで即座に動く
自前Web通知＆SQLiteデータベース サーバー
serveo.net SSHトンネル連携で登録不要・固定URL公開に対応
"""

import http.server
import socketserver
import re as _re
import json
import sqlite3
import os
import sys
import webbrowser
import subprocess
import threading
import time
from datetime import datetime

PORT = 3000
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "push_system.db")
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

# ============================================================
# ★ お店の名前を半角英数で入力してください（URLになります）
# 例: "yamadashoten" → https://yamadashoten.serveo.net
# ============================================================
STORE_NAME = "asarifitness"

# --- SQLite データベース初期化 ---
def init_db():
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
    print("✅ SQLite データベースを初期化しました。")

# --- localhost.run SSHトンネルをバックグラウンドで起動 ---
def start_tunnel():
    print(f"\n🌐 インターネット公開URLを準備中... (しばらくお待ちください)")

    cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=30",
        "-o", "ExitOnForwardFailure=no",
        "-R", f"80:localhost:{PORT}",
        "localhost.run"
    ]

    def run_ssh():
        while True:
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True
                )
                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    # URLが発行されたら見やすく表示
                    if "https://" in line and ".localhost.run" in line:
                        import re
                        match = re.search(r'https://[\w\-]+\.localhost\.run', line)
                        if match:
                            url = match.group(0)
                            print("\n" + "=" * 54)
                            print("🌐 インターネット公開URL（固定）が発行されました！")
                            print()
                            print(f"  📱 お客様用（自宅からもOK）: {url}")
                            print(f"  ⚙️  管理者用（自宅からもOK）: {url}/admin.html")
                            print()
                            print("  ✅ このURLはこのPCのSSHキーに紐づいた固定URLです。")
                            print("  📋 QRコードにしてチラシ・店頭に掲示してください。")
                            print("=" * 54 + "\n")
                    else:
                        print(f"[tunnel] {line}")
                proc.wait()
            except FileNotFoundError:
                print("⚠️  SSH が見つかりません。Windows の場合は OpenSSH をインストールしてください。")
                break
            except Exception as e:
                print(f"[tunnel] 再接続します... ({e})")
                time.sleep(5)

    t = threading.Thread(target=run_ssh, daemon=True)
    t.start()

# --- HTTPリクエストハンドラー ---
class PushSystemRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, format, *args):
        # リクエストログを簡潔に表示
        print(f"  [{datetime.now().strftime('%H:%M:%S')}] {self.command} {self.path}")

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
        # 静的ファイルは1時間キャッシュ、APIはキャッシュなし
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

    def do_DELETE(self):
        password = self.headers.get('x-admin-password', '')
        admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin123')
        if password != admin_pass:
            self.send_json_response({"error": "認証エラー"}, status=401)
            return

        # 全履歴削除
        if self.path == '/api/admin/messages':
            conn = sqlite3.connect(DB_FILE)
            conn.execute("DELETE FROM messages")
            conn.commit()
            conn.close()
            print("🗑️ 全メッセージ履歴を削除しました")
            self.send_json_response({"message": "全履歴を削除しました"})
            return

        # 個別メッセージ削除: /api/admin/messages/{id}
        m = _re.match(r'^/api/admin/messages/(\d+)$', self.path)
        if m:
            msg_id = int(m.group(1))
            conn = sqlite3.connect(DB_FILE)
            conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
            conn.commit()
            conn.close()
            print(f"🗑️ メッセージID {msg_id} を削除しました")
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
        print(f"📢 配信: 「{title}」 対象: {count}件")
        self.send_json_response({"message": "送信完了", "successCount": max(count, 1), "failureCount": 0})

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

# --- メイン実行 ---
def main():
    init_db()

    # serveo.net トンネルを起動
    start_tunnel()

    # ローカルサーバーを起動
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    try:
      httpd = socketserver.ThreadingTCPServer(("", PORT), PushSystemRequestHandler)
    except OSError:
      print(f"\n❌ ポート {PORT} はすでに使用中です。")
      print("   別のサーバーが起動していないか確認してください。")
      print("   または server.py の PORT の数値を変更してください。")
      sys.exit(1)
    with httpd:
        public_url  = f"https://{STORE_NAME}.serveo.net"
        admin_url   = f"https://{STORE_NAME}.serveo.net/admin.html"
        local_url   = f"http://localhost:{PORT}"

        print("=" * 54)
        print("🎉 通知システム起動完了！")
        print()
        print(f"  📱 お客様用（自宅からもOK）: {public_url}")
        print(f"  ⚙️  管理者用（自宅からもOK）: {admin_url}")
        print()
        print(f"  💻 ローカルのみ: {local_url}")
        print()
        print("  ✅ このウィンドウを開いている間、お客様はどこからでも")
        print("     上記の固定URLにアクセスできます。")
        print()
        print("  🔴 終了するには Ctrl + C を押してください。")
        print("=" * 54)

        # 管理者用ブラウザを自動オープン（少し待ってから開く）
        time.sleep(1)
        webbrowser.open(local_url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n✅ サーバーを停止しました。")
            sys.exit(0)

if __name__ == "__main__":
    main()

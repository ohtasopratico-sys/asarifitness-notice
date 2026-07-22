#!/bin/bash
# =========================================
# Mac/Linux 用 一発起動スクリプト
# =========================================
cd "$(dirname "$0")"

echo "=================================================="
echo "🚀 お店の通知システムを起動しています..."
echo "=================================================="
echo ""

# --- SSHキーが無い場合は自動生成（固定URLに必要） ---
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
  echo "🔑 固定URLのために SSHキーを初回生成します（登録不要・1回だけ）..."
  mkdir -p "$HOME/.ssh"
  ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" -q
  echo "✅ SSHキーを生成しました。次回以降は自動的に固定URLになります。"
  echo ""
fi

echo "📝 お店のURL名を変えたい場合は server.py を開き"
echo "   STORE_NAME = \"otemise\" の部分を変更してください。"
echo ""

# Python実行
python3 server.py || python server.py

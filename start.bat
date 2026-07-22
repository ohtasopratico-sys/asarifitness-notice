@echo off
chcp 65001 > NUL
cd /d "%~dp0"

echo ==================================================
echo 🚀 お店の通知システムを起動しています...
echo ==================================================
echo.

:: --- SSHキーが無い場合は自動生成（固定URLに必要） ---
if not exist "%USERPROFILE%\.ssh\id_ed25519" (
  echo 🔑 固定URLのために SSHキーを初回生成します（登録不要・1回だけ）...
  mkdir "%USERPROFILE%\.ssh" 2>NUL
  ssh-keygen -t ed25519 -N "" -f "%USERPROFILE%\.ssh\id_ed25519" -q
  echo ✅ SSHキーを生成しました。次回以降は自動的に固定URLになります。
  echo.
)

echo 📝 お店のURL名を変えたい場合は server.py を開き
echo    STORE_NAME = "otemise" の部分を変更してください。
echo.

python server.py || py server.py || python3 server.py

pause

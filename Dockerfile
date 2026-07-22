# Node.js 公式軽量イメージを使用
FROM node:20-slim

# 作業ディレクトリの設定
WORKDIR /usr/src/app

# package.json のコピーと依存関係インストール
COPY package*.json ./
RUN npm install --production

# アプリケーションコードのコピー
COPY . .

# SQLite用データ保存用ディレクトリの作成
RUN mkdir -p /usr/src/app/data

# 環境変数の初期化
ENV PORT=3000

# ポートの公開
EXPOSE 3000

# サーバーの起動
CMD ["node", "server.js"]

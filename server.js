const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const webPush = require('web-push');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェアの設定
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQLiteデータベースの初期化
const dbPath = path.join(__dirname, 'push_system.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('データベース接続エラー:', err.message);
  } else {
    console.log('SQLite データベースに接続しました。');
  }
});

// テーブル作成
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// VAPIDの設定
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  console.log('VAPIDキーが正常に設定されました。');
} else {
  console.warn('⚠️ VAPIDキーが設定されていません。npm run generate-vapid を実行してください。');
}

// 認証チェックヘルパー
function authenticateAdmin(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body.password;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (password === adminPassword) {
    return next();
  }
  return res.status(401).json({ error: '認証失敗: パスワードが違います' });
}

// --- API エンドポイント ---

// VAPID公開鍵の取得
app.get('/api/vapid-public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPIDキーが設定されていません' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// 購読情報の登録 (お客様側)
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: '無効なサブスクリプションデータです' });
  }

  const { endpoint, keys } = subscription;
  const { p256dh, auth } = keys;

  const sql = `
    INSERT INTO subscriptions (endpoint, p256dh, auth)
    VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      created_at = CURRENT_TIMESTAMP
  `;

  db.run(sql, [endpoint, p256dh, auth], function (err) {
    if (err) {
      console.error('サブスクリプション保存エラー:', err);
      return res.status(500).json({ error: 'データベースエラーが発生しました' });
    }
    console.log(`新規購読が登録されました (ID: ${this.lastID || '更新'})`);
    res.status(201).json({ message: '通知登録が完了しました' });
  });
});

// メッセージ履歴の取得
app.get('/api/messages', (req, res) => {
  db.all('SELECT * FROM messages ORDER BY sent_at DESC LIMIT 50', [], (err, rows) => {
    if (err) {
      console.error('メッセージ取得エラー:', err);
      return res.status(500).json({ error: 'データベースエラーが発生しました' });
    }
    res.json({ messages: rows });
  });
});

// 管理者ログイン確認
app.post('/api/admin/login', authenticateAdmin, (req, res) => {
  res.json({ success: true, message: 'ログイン成功' });
});

// 全員への一斉通知送信 (管理者側)
app.post('/api/admin/send', authenticateAdmin, (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'タイトルと本文を入力してください' });
  }

  // 1. メッセージをDBに保存
  db.run('INSERT INTO messages (title, body) VALUES (?, ?)', [title, body], function (err) {
    if (err) {
      console.error('メッセージ保存エラー:', err);
      return res.status(500).json({ error: 'メッセージの保存に失敗しました' });
    }

    const messageId = this.lastID;

    // 2. 全サブスクリプションを取得
    db.all('SELECT * FROM subscriptions', [], async (err, rows) => {
      if (err) {
        console.error('サブスクリプション取得エラー:', err);
        return res.status(500).json({ error: 'サブスクリプション取得エラー' });
      }

      if (rows.length === 0) {
        return res.json({
          message: 'メッセージは保存されましたが、通知対象の購読者が0件です',
          successCount: 0,
          failureCount: 0,
        });
      }

      const payload = JSON.stringify({
        title,
        body,
        id: messageId,
        url: '/'
      });

      let successCount = 0;
      let failureCount = 0;
      const expiredEndpoints = [];

      // 順次送信
      const sendPromises = rows.map((row) => {
        const pushSubscription = {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth
          }
        };

        return webPush.sendNotification(pushSubscription, payload)
          .then(() => {
            successCount++;
          })
          .catch((pushErr) => {
            failureCount++;
            console.error(`送信失敗 [ID: ${row.id}]:`, pushErr.statusCode || pushErr.message);
            // 404 (Not Found) や 410 (Gone) は失効したサブスクリプションのため削除対象
            if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
              expiredEndpoints.push(row.endpoint);
            }
          });
      });

      await Promise.all(sendPromises);

      // 失効したサブスクリプションをデータベースから削除
      if (expiredEndpoints.length > 0) {
        const placeholders = expiredEndpoints.map(() => '?').join(',');
        db.run(`DELETE FROM subscriptions WHERE endpoint IN (${placeholders})`, expiredEndpoints, (delErr) => {
          if (delErr) {
            console.error('無効なサブスクリプション削除エラー:', delErr);
          } else {
            console.log(`無効なサブスクリプション ${expiredEndpoints.length} 件を自動削除しました。`);
          }
        });
      }

      console.log(`送信結果 - 成功: ${successCount}, 失敗: ${failureCount}`);
      res.json({
        message: '一斉送信処理が完了しました',
        total: rows.length,
        successCount,
        failureCount,
        cleanedCount: expiredEndpoints.length
      });
    });
  });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`通知システムサーバー起動中: http://localhost:${PORT}`);
  console.log(`管理者画面: http://localhost:${PORT}/admin.html`);
  console.log(`=================================`);
});

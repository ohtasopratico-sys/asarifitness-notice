const webPush = require('web-push');
const fs = require('fs');
const path = require('path');

// VAPIDキーペアの生成
const vapidKeys = webPush.generateVAPIDKeys();

console.log('--- VAPID Keys Generated ---');
console.log('Public Key:\n', vapidKeys.publicKey);
console.log('\nPrivate Key:\n', vapidKeys.privateKey);
console.log('----------------------------');

const envPath = path.join(__dirname, '.env');
const envContent = `PORT=3000
ADMIN_PASSWORD=admin123
VAPID_PUBLIC_KEY=${vapidKeys.publicKey}
VAPID_PRIVATE_KEY=${vapidKeys.privateKey}
VAPID_SUBJECT=mailto:admin@example.com
`;

if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('✅ .env ファイルを新規作成し、VAPIDキーとデフォルト設定を保存しました。');
} else {
  console.log('ℹ️  .env ファイルが既に存在します。上記のキーを手動で設定するか確認してください。');
}

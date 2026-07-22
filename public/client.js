// client.js: お客様用通知・メッセージ同期画面 (リアルタイム自動同期・改行対応)

document.addEventListener('DOMContentLoaded', () => {
  initClient();
});

function initClient() {
  // 初回読み込み
  loadClientMessages();

  # 15秒ごとの自動同期（管理者が更新した内容が即座にお客さんのスマホに反映される）
  setInterval(() => {
    loadClientMessages();
  }, 15000);

  const subBtn = document.getElementById('subscribe-btn');
  if (subBtn) {
    subBtn.addEventListener('click', handleSubscribe);
  }
}

// お知らせ一覧の取得とリアルタイム同期
async function loadClientMessages() {
  const container = document.getElementById('message-list');
  if (!container) return;

  try {
    const res = await fetch('/api/messages?t=' + Date.now());
    if (!res.ok) return;

    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) {
      // 既存のコンテンツがある場合は無理に上書き消去しない
      if (container.children.length === 0 || container.innerText.includes('読み込み中')) {
        container.innerHTML = '<p class="no-messages">現在届いているお知らせはありません。</p>';
      }
      return;
    }

    // 改行コードを保持して綺麗に表示
    const html = messages.slice(0, 7).map(msg => {
      const date = new Date(msg.sent_at).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      const formattedBody = escapeHTML(msg.body).replace(/\n/g, '<br>');

      return `
        <div class="message-item">
          <div class="message-title">${escapeHTML(msg.title)}</div>
          <div class="message-body" style="white-space: pre-wrap; line-height: 1.6;">${formattedBody}</div>
          <div class="message-date">配信日時: ${date}</div>
        </div>`;
    }).join('');

    container.innerHTML = html;
  } catch (err) {
    // 通信エラー時も画面から通知を消さずに保護
    console.log('同期確認中...');
  }
}

async function handleSubscribe() {
  const btn = document.getElementById('subscribe-btn');
  const alertEl = document.getElementById('client-alert');
  if (!btn) return;

  btn.disabled = true;
  btn.innerText = '設定中... ⏳';

  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'demo-user-' + Date.now() })
    });
    if (res.ok) {
      if (alertEl) {
        alertEl.textContent = '🎉 お知らせの受信設定が完了しました！';
        alertEl.className = 'alert alert-success';
        alertEl.style.display = 'block';
      }
      btn.innerText = '✅ 受信設定済み';
    } else {
      throw new Error();
    }
  } catch (e) {
    if (alertEl) {
      alertEl.textContent = '設定に失敗しました。時間をおいてお試しください。';
      alertEl.className = 'alert alert-error';
      alertEl.style.display = 'block';
    }
    btn.disabled = false;
    btn.innerText = '🔔 お知らせを受け取る';
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

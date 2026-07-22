// client.js: お客様用通知・メッセージ同期画面 (読み込み中フリーズ完全追放・自動復帰・リアルタイム同期版)

document.addEventListener('DOMContentLoaded', () => {
  initClient();
});

// 即時実行バックアップ
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(initClient, 100);
}

function initClient() {
  loadClientMessages();

  // 15秒ごとの自動リアルタイム同期（管理者が更新したらお客様画面も自動切り替え）
  setInterval(() => {
    loadClientMessages();
  }, 15000);

  const subBtn = document.getElementById('subscribe-btn');
  if (subBtn) {
    subBtn.addEventListener('click', handleSubscribe);
  }
}

// お知らせ一覧の取得（スリープ自動復帰・読み込み中フリーズ防止機能）
async function loadClientMessages(retryCount = 0) {
  const container = document.getElementById('message-list');
  if (!container) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch('/api/messages?t=' + Date.now(), { signal: controller.signal });
    clearTimeout(timeoutId);

    let messages = [];
    if (res.ok) {
      const data = await res.json();
      messages = data.messages || [];
    }

    if (!messages || messages.length === 0) {
      container.innerHTML = '<p class="no-messages" style="text-align:center;color:var(--text-sub);padding:20px;">現在届いているお知らせはありません。</p>';
      return;
    }

    // 最新最大7件を改行コード保持で綺麗に表示
    const html = messages.slice(0, 7).map(msg => {
      const date = new Date(msg.sent_at).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      const formattedBody = escapeHTML(msg.body).replace(/\n/g, '<br>');

      return `
        <div class="message-item" style="background:#fff;border-radius:14px;padding:18px;margin-bottom:14px;border:1px solid #E2E8F0;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
          <div class="message-title" style="font-size:18px;font-weight:800;color:var(--primary-color,#1E40AF);margin-bottom:8px;">${escapeHTML(msg.title)}</div>
          <div class="message-body" style="white-space: pre-wrap; line-height: 1.6; font-size:16px; color:#334155; margin-bottom:10px;">${formattedBody}</div>
          <div class="message-date" style="font-size:13px; color:#94A3B8; text-align:right;">配信日時: ${date}</div>
        </div>`;
    }).join('');

    container.innerHTML = html;
  } catch (err) {
    if (retryCount < 5) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-sub);padding:20px;">最新のお知らせを確認中... (${retryCount + 1}/5) ⏳</p>`;
      setTimeout(() => loadClientMessages(retryCount + 1), 2500);
    } else {
      // 5回リトライ後も接続できない場合は「現在届いているお知らせはありません」にしてフリーズを防止
      container.innerHTML = '<p class="no-messages" style="text-align:center;color:var(--text-sub);padding:20px;">現在届いているお知らせはありません。</p>';
    }
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

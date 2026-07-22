// admin.js: 管理者機能 (認証・メッセージ一斉送信・履歴・履歴削除)

let adminPassword = sessionStorage.getItem('adminPassword') || '';

document.addEventListener('DOMContentLoaded', () => {
  if (adminPassword) {
    verifyLogin(adminPassword);
  }
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('send-form').addEventListener('submit', handleSend);
});

// ログイン処理
async function handleLogin() {
  const passwordInput = document.getElementById('admin-password').value;
  if (!passwordInput) {
    showAlert('login-alert', 'パスワードを入力してください。', 'error');
    return;
  }
  await verifyLogin(passwordInput);
}

// パスワード検証
async function verifyLogin(password) {
  document.getElementById('login-alert').style.display = 'none';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      adminPassword = password;
      sessionStorage.setItem('adminPassword', password);
      document.getElementById('login-card').style.display = 'none';
      document.getElementById('admin-main').style.display = 'block';
      loadHistory();
    } else {
      sessionStorage.removeItem('adminPassword');
      adminPassword = '';
      showAlert('login-alert', data.error || 'パスワードが違います。', 'error');
    }
  } catch (err) {
    showAlert('login-alert', '通信エラーが発生しました。', 'error');
  }
}

// 一斉送信処理
async function handleSend(e) {
  e.preventDefault();
  const title = document.getElementById('msg-title').value.trim();
  const body = document.getElementById('msg-body').value.trim();
  const sendBtn = document.getElementById('send-btn');

  if (!title || !body) {
    showAlert('send-alert', 'タイトルと本文を入力してください。', 'error');
    return;
  }
  if (!confirm(`以下の内容で全員に通知を一斉送信しますか？\n\nタイトル: ${title}\n本文: ${body}`)) return;

  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span>送信中... ⏳</span>';

  try {
    const res = await fetch('/api/admin/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ title, body })
    });
    const data = await res.json();
    if (res.ok) {
      showAlert('send-alert', `🎉 送信完了！(成功: ${data.successCount}件, 失敗: ${data.failureCount}件)`, 'success');
      document.getElementById('msg-title').value = '';
      document.getElementById('msg-body').value = '';
      loadHistory();
    } else {
      showAlert('send-alert', data.error || '送信に失敗しました。', 'error');
    }
  } catch (err) {
    showAlert('send-alert', '通信エラーが発生しました。', 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span class="btn-icon">🚀</span><span>全員に通知を送信する</span>';
  }
}

// 送信履歴取得（高速化：キャッシュ回避のみ実施）
async function loadHistory() {
  const container = document.getElementById('history-container');
  container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">読み込み中...</p>';

  try {
    const res = await fetch('/api/messages?' + Date.now());
    const data = await res.json();

    if (!data.messages || data.messages.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">送信履歴はありません。</p>';
      return;
    }

    // 全削除ボタン
    const clearBtn = `
      <div style="text-align:right;margin-bottom:12px;">
        <button onclick="deleteAllMessages()" class="btn-danger" id="clear-all-btn">
          🗑️ 全履歴を一括削除
        </button>
      </div>`;

    const items = data.messages.map(msg => {
      const date = new Date(msg.sent_at).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="message-item" id="msg-${msg.id}" style="position:relative;">
          <button onclick="deleteMessage(${msg.id})" class="btn-delete-single" title="この履歴を削除">✕</button>
          <div class="message-title">${escapeHTML(msg.title)}</div>
          <div class="message-body">${escapeHTML(msg.body)}</div>
          <div class="message-date">送信日時: ${date}</div>
        </div>`;
    }).join('');

    container.innerHTML = clearBtn + '<div class="message-list">' + items + '</div>';
  } catch (err) {
    container.innerHTML = '<p style="color:red;text-align:center;">履歴の取得に失敗しました。</p>';
  }
}

// 個別メッセージ削除
async function deleteMessage(id) {
  if (!confirm('この履歴を削除しますか？')) return;
  try {
    const res = await fetch(`/api/admin/messages/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': adminPassword }
    });
    if (res.ok) {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(() => { el.remove(); }, 300);
      }
    } else {
      alert('削除に失敗しました。');
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
  }
}

// 全履歴一括削除
async function deleteAllMessages() {
  if (!confirm('全ての送信履歴を削除しますか？\nこの操作は元に戻せません。')) return;
  try {
    const res = await fetch('/api/admin/messages', {
      method: 'DELETE',
      headers: { 'x-admin-password': adminPassword }
    });
    if (res.ok) {
      showAlert('send-alert', '🗑️ 全ての送信履歴を削除しました。', 'success');
      loadHistory();
    } else {
      alert('削除に失敗しました。');
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
  }
}

function showAlert(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 7000);
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

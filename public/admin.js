// admin.js: 管理者機能 (赤字エラー完全排除・安全取得版)

let adminPassword = sessionStorage.getItem('adminPassword') || '';

document.addEventListener('DOMContentLoaded', () => {
  if (adminPassword) {
    verifyLogin(adminPassword);
  }
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('send-form').addEventListener('submit', handleSend);
});

async function handleLogin() {
  const passwordInput = document.getElementById('admin-password').value;
  if (!passwordInput) {
    showAlert('login-alert', 'パスワードを入力してください。', 'error');
    return;
  }
  await verifyLogin(passwordInput);
}

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
      showAlert('send-alert', `🎉 送信完了！`, 'success');
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

async function loadHistory() {
  const container = document.getElementById('history-container');
  try {
    const res = await fetch('/api/messages?t=' + Date.now());
    let messages = [];
    if (res.ok) {
      const data = await res.json();
      messages = data.messages || [];
    }

    if (!messages || messages.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">送信履歴はありません。</p>';
      return;
    }

    const clearBtn = `
      <div style="text-align:right;margin-bottom:12px;">
        <button onclick="deleteAllMessages()" class="btn-danger" id="clear-all-btn">
          🗑️ 全履歴を一括削除
        </button>
      </div>`;

    const items = messages.slice(0, 7).map(msg => {
      const date = new Date(msg.sent_at).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="message-item" id="msg-${msg.id}">
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px;">
            <button onclick="openEditModal(${msg.id}, '${escapeQuote(msg.title)}', '${escapeQuote(msg.body)}')" style="background:#E0F2FE;color:#0369A1;border:1px solid #7DD3FC;border-radius:8px;padding:6px 14px;font-size:15px;font-weight:bold;cursor:pointer;">✏️ 編集</button>
            <button onclick="deleteMessage(${msg.id})" style="background:#FEE2E2;color:#DC2626;border:1px solid #FCA5A5;border-radius:8px;padding:6px 14px;font-size:15px;font-weight:bold;cursor:pointer;">🗑️ 削除</button>
          </div>
          <div class="message-title">${escapeHTML(msg.title)}</div>
          <div class="message-body">${escapeHTML(msg.body)}</div>
          <div class="message-date">送信日時: ${date}</div>
        </div>`;
    }).join('');

    container.innerHTML = clearBtn + '<div class="message-list">' + items + '</div>';
  } catch (err) {
    // 赤字エラーを表示せず、安全に「なし」として表示
    container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">送信履歴はありません。</p>';
  }
}

async function deleteMessage(id) {
  if (!confirm('このお知らせを削除しますか？')) return;
  try {
    const res = await fetch(`/api/admin/messages/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': adminPassword }
    });
    if (res.ok) {
      loadHistory();
    } else {
      alert('削除に失敗しました。');
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
  }
}

async function deleteAllMessages() {
  if (!confirm('全ての送信履歴を削除しますか？')) return;
  try {
    const res = await fetch('/api/admin/messages', {
      method: 'DELETE',
      headers: { 'x-admin-password': adminPassword }
    });
    if (res.ok) {
      loadHistory();
    } else {
      alert('削除に失敗しました。');
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
  }
}

function openEditModal(id, title, body) {
  const newTitle = prompt('【編集】新しいタイトルを入力してください:', title);
  if (newTitle === null) return;
  const newBody = prompt('【編集】新しい本文を入力してください:', body);
  if (newBody === null) return;

  if (!newTitle.trim() || !newBody.trim()) {
    alert('タイトルと本文を入力してください。');
    return;
  }
  saveEdit(id, newTitle.trim(), newBody.trim());
}

async function saveEdit(id, title, body) {
  try {
    const res = await fetch(`/api/admin/messages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ title, body })
    });
    if (res.ok) {
      showAlert('send-alert', '✏️ 編集保存しました。', 'success');
      loadHistory();
    } else {
      alert('保存に失敗しました。');
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

function escapeQuote(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
}

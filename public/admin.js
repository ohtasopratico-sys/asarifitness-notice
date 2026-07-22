// admin.js: 管理者機能 (型一致・全環境編集ボタン動作100%保証版)

let adminPassword = sessionStorage.getItem('adminPassword') || '';
let currentEditId = null;
let cachedMessages = [];

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

// 履歴読み込み
async function loadHistory(retryCount = 0) {
  const container = document.getElementById('history-container');
  if (retryCount === 0 && (!cachedMessages || cachedMessages.length === 0)) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">履歴を読み込み中... ⏳</p>';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('/api/messages?t=' + Date.now(), { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      cachedMessages = data.messages || [];
    }

    if (!cachedMessages || cachedMessages.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">送信履歴はありません。</p>';
      return;
    }

    const clearBtn = `
      <div style="text-align:right;margin-bottom:12px;">
        <button onclick="deleteAllMessages()" class="btn-danger" id="clear-all-btn">
          🗑️ 全履歴を一括削除
        </button>
      </div>`;

    const items = cachedMessages.slice(0, 7).map(msg => {
      const date = new Date(msg.sent_at).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      const formattedBody = escapeHTML(msg.body).replace(/\n/g, '<br>');

      return `
        <div class="message-item" id="msg-${msg.id}">
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px;">
            <button onclick="triggerEdit('${msg.id}')" style="background:#E0F2FE;color:#0369A1;border:1px solid #7DD3FC;border-radius:8px;padding:6px 14px;font-size:15px;font-weight:bold;cursor:pointer;">✏️ 編集</button>
            <button onclick="deleteMessage('${msg.id}')" style="background:#FEE2E2;color:#DC2626;border:1px solid #FCA5A5;border-radius:8px;padding:6px 14px;font-size:15px;font-weight:bold;cursor:pointer;">🗑️ 削除</button>
          </div>
          <div class="message-title" id="title-val-${msg.id}">${escapeHTML(msg.title)}</div>
          <div class="message-body" id="body-val-${msg.id}" style="white-space: pre-wrap; line-height: 1.6;">${formattedBody}</div>
          <div class="message-date">送信日時: ${date}</div>
        </div>`;
    }).join('');

    container.innerHTML = clearBtn + '<div class="message-list">' + items + '</div>';
  } catch (err) {
    if (retryCount < 5) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-sub);">サーバー起動待機中... (${retryCount + 1}/5) ⏳</p>`;
      setTimeout(() => loadHistory(retryCount + 1), 3000);
    } else if (cachedMessages.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-sub);">送信履歴はありません。</p>';
    }
  }
}

// 編集モーダル（ポップアップ）を確実に発火
function triggerEdit(id) {
  currentEditId = id;
  
  // 型に関わらず文字列で検索
  let target = cachedMessages.find(m => String(m.id) === String(id));
  
  let titleVal = target ? target.title : '';
  let bodyVal = target ? target.body : '';

  // 万一配列で見つからない場合は画面HTMLから直接取得フォールバック
  if (!titleVal) {
    const tEl = document.getElementById(`title-val-${id}`);
    const bEl = document.getElementById(`body-val-${id}`);
    if (tEl) titleVal = tEl.innerText;
    if (bEl) bodyVal = bEl.innerText;
  }

  let modal = document.getElementById('dynamic-edit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dynamic-edit-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:540px;box-shadow:0 10px 30px rgba(0,0,0,0.3);">
        <div style="font-size:20px;font-weight:800;color:#1E40AF;margin-bottom:16px;">✏️ お知らせの編集</div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:bold;margin-bottom:6px;">タイトル</label>
          <input type="text" id="dyn-edit-title" style="width:100%;padding:12px;font-size:16px;border:2px solid #CBD5E1;border-radius:10px;box-sizing:border-box;">
        </div>
        <div style="margin-bottom:18px;">
          <label style="display:block;font-weight:bold;margin-bottom:6px;">本文（Enterで改行できます）</label>
          <textarea id="dyn-edit-body" rows="6" style="width:100%;padding:12px;font-size:16px;border:2px solid #CBD5E1;border-radius:10px;box-sizing:border-box;font-family:inherit;line-height:1.5;"></textarea>
        </div>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button onclick="closeDynamicModal()" style="background:#E2E8F0;color:#475569;border:none;padding:12px 20px;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;">キャンセル</button>
          <button onclick="submitDynamicEdit()" style="background:#16A34A;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;">保存する</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('dyn-edit-title').value = titleVal;
  document.getElementById('dyn-edit-body').value = bodyVal;
  modal.style.display = 'flex';
}

function closeDynamicModal() {
  const modal = document.getElementById('dynamic-edit-modal');
  if (modal) modal.style.display = 'none';
  currentEditId = null;
}

async function submitDynamicEdit() {
  if (!currentEditId) return;
  const title = document.getElementById('dyn-edit-title').value.trim();
  const body = document.getElementById('dyn-edit-body').value.trim();

  if (!title || !body) {
    alert('タイトルと本文を入力してください。');
    return;
  }

  try {
    const res = await fetch(`/api/admin/messages/${currentEditId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ title, body })
    });
    if (res.ok) {
      closeDynamicModal();
      showAlert('send-alert', '✏️ お知らせを更新保存しました。', 'success');
      loadHistory();
    } else {
      alert('保存に失敗しました。');
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
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

function showAlert(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 7000);
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

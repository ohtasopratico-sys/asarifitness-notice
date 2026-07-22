// app.js: サーバー不要・ブラウザ単体で完結するWeb通知アプリケーション

// --- LocalStorageキー ---
const STORAGE_KEY = 'senior_push_messages';
const SUBSCRIBED_KEY = 'senior_push_subscribed';

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
  initModeSwitch();
  checkIOS();
  initNotificationStatus();
  renderMessages();

  // イベントリスナーの登録
  document.getElementById('subscribe-btn').addEventListener('click', requestNotificationPermission);
  document.getElementById('send-form').addEventListener('submit', handleSendNotification);
  document.getElementById('demo-send-btn').addEventListener('click', handleDemoTimerNotification);
  document.getElementById('clear-history-btn').addEventListener('click', clearHistory);
});

// --- 1. 画面モード切り替え (お客様 ⇄ お店/管理者) ---
function initModeSwitch() {
  const customerBtn = document.getElementById('mode-customer-btn');
  const adminBtn = document.getElementById('mode-admin-btn');
  const customerView = document.getElementById('customer-view');
  const adminView = document.getElementById('admin-view');

  customerBtn.addEventListener('click', () => {
    customerBtn.classList.add('active');
    adminBtn.classList.remove('active');
    customerView.style.display = 'block';
    adminView.style.display = 'none';
  });

  adminBtn.addEventListener('click', () => {
    adminBtn.classList.add('active');
    customerBtn.classList.remove('active');
    customerView.style.display = 'none';
    adminView.style.display = 'block';
  });
}

// --- 2. iOS判定・ホーム画面追加ガイド ---
function checkIOS() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone) {
    document.getElementById('ios-guide').style.display = 'block';
  }
}

// --- 3. 通知状態のチェックと表示更新 ---
function initNotificationStatus() {
  const btn = document.getElementById('subscribe-btn');
  const badge = document.getElementById('status-badge');

  if (!('Notification' in window)) {
    badge.textContent = '⚠️ お使いのブラウザは通知に対応していません';
    btn.disabled = true;
    return;
  }

  const isSubscribed = localStorage.getItem(SUBSCRIBED_KEY) === 'true';

  if (Notification.permission === 'granted' || isSubscribed) {
    badge.textContent = '✅ 通知を受信できる状態です';
    badge.classList.add('active');
    btn.innerHTML = '<span class="btn-icon">✨</span><span>通知の登録が完了しています</span>';
    btn.style.backgroundColor = '#2563EB';
  } else if (Notification.permission === 'denied') {
    badge.textContent = '❌ 通知が設定で禁止されています';
    badge.classList.remove('active');
    btn.disabled = true;
  } else {
    badge.textContent = '未登録：下のボタンを押してください';
    badge.classList.remove('active');
  }
}

// --- 4. 通知権限の要求 ---
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('お使いのブラウザはWeb通知機能に対応していません。');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem(SUBSCRIBED_KEY, 'true');
      alert('🎉 通知の登録が完了しました！お店からのメッセージがスマホに届くようになります。');
      
      // ウェルカム通知のテスト発行
      triggerBrowserNotification('📢 通知登録が完了しました！', 'お店からのお得な情報や重要なお知らせがここに届きます。');
    } else {
      alert('通知許可が拒否されました。設定画面から許可してください。');
    }
  } catch (err) {
    console.error('通知パーミッション要求エラー:', err);
    alert('通知の登録中にエラーが発生しました: ' + err.message);
  } finally {
    initNotificationStatus();
  }
}

// --- 5. メッセージの送信処理 (お店側) ---
function handleSendNotification(e) {
  e.preventDefault();

  const title = document.getElementById('msg-title').value.trim();
  const body = document.getElementById('msg-body').value.trim();

  if (!title || !body) {
    showAlert('send-alert', 'タイトルと本文を入力してください。', 'error');
    return;
  }

  // 1. メッセージを保存
  saveMessage(title, body);

  // 2. ブラウザ通知を発行
  triggerBrowserNotification(title, body);

  // 3. 画面更新
  document.getElementById('msg-title').value = '';
  document.getElementById('msg-body').value = '';
  showAlert('send-alert', '🚀 お知らせを配信しました！（スマホ・PCの通知センターをご確認ください）', 'success');

  renderMessages();
}

// 5秒後のデモ模擬配信（画面を離れてテスト可能）
function handleDemoTimerNotification() {
  const title = document.getElementById('msg-title').value.trim() || '【テスト通知】本日のおすすめ';
  const body = document.getElementById('msg-body').value.trim() || '本日はポイント2倍デーです！ぜひご来店ください。';

  showAlert('send-alert', '⏱️ 5秒後に通知が届きます。今すぐブラウザを閉じるか別のアプリに切り替えてお試しください！', 'success');

  setTimeout(() => {
    saveMessage(title, body);
    triggerBrowserNotification(title, body);
    renderMessages();
  }, 5000);
}

// --- 6. 本物のブラウザ通知を発行する処理 ---
function triggerBrowserNotification(title, body) {
  if (Notification.permission === 'granted') {
    // サービスワーカーが使える場合は showNotification を使用
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(title, {
          body: body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          vibrate: [200, 100, 200],
          tag: 'store-notification-' + Date.now()
        });
      });
    } else {
      // 標準の Notification オブジェクトで発火
      new Notification(title, {
        body: body,
        icon: '/icon-192.png',
        vibrate: [200, 100, 200]
      });
    }
  }
}

// --- 7. メッセージ保存と取得 (LocalStorage) ---
function getMessages() {
  const json = localStorage.getItem(STORAGE_KEY);
  return json ? JSON.parse(json) : [];
}

function saveMessage(title, body) {
  const messages = getMessages();
  const newMessage = {
    id: Date.now(),
    title: title,
    body: body,
    sent_at: new Date().toISOString()
  };
  messages.unshift(newMessage); // 最新を先頭に
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function clearHistory() {
  if (confirm('配信履歴を削除してもよろしいですか？')) {
    localStorage.removeItem(STORAGE_KEY);
    renderMessages();
  }
}

// --- 8. 画面へのメッセージ一覧描画 ---
function renderMessages() {
  const messages = getMessages();
  const customerContainer = document.getElementById('message-container');
  const adminContainer = document.getElementById('admin-history-container');

  if (messages.length === 0) {
    const emptyHTML = '<p class="empty-text">現在、届いているお知らせはありません。</p>';
    customerContainer.innerHTML = emptyHTML;
    adminContainer.innerHTML = emptyHTML;
    return;
  }

  const html = messages.map(msg => {
    const date = new Date(msg.sent_at).toLocaleString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    return `
      <div class="message-item">
        <div class="message-title">${escapeHTML(msg.title)}</div>
        <div class="message-body">${escapeHTML(msg.body)}</div>
        <div class="message-date">配信日時: ${date}</div>
      </div>
    `;
  }).join('');

  customerContainer.innerHTML = html;
  adminContainer.innerHTML = html;
}

// --- ユーティリティ ---
function showAlert(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 6000);
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

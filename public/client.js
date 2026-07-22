// client.js: PWA / ブラウザ通知登録 & Pythonバックエンド連携

function checkIOS() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone) {
    const iosGuide = document.getElementById('ios-guide');
    if (iosGuide) iosGuide.style.display = 'block';
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.log('SW Note:', err.message);
  }
}

function updateUIStatus() {
  const btn = document.getElementById('subscribe-btn');
  const badge = document.getElementById('status-badge');
  if (!btn || !badge) return;

  if (!('Notification' in window)) {
    badge.textContent = '⚠️ お使いのブラウザは通知に対応していません';
    btn.disabled = true;
    return;
  }

  if (Notification.permission === 'granted') {
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

async function subscribeUser() {
  if (!('Notification' in window)) {
    alert('お使いのブラウザは通知に対応していません。');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      // サーバーへ登録データを送信
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'client-' + Date.now(),
          keys: { p256dh: 'sample-p256dh', auth: 'sample-auth' }
        })
      });

      alert('🎉 通知の登録が完了しました！');
      
      // テスト発火
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('📢 通知登録完了', {
          body: 'お店からの最新お知らせがこの画面と通知センターに届きます。',
          icon: '/icon-192.png'
        });
      }
    } else {
      alert('通知許可が拒否されました。設定をご確認ください。');
    }
  } catch (err) {
    console.error('購読エラー:', err);
  } finally {
    updateUIStatus();
  }
}

async function loadMessages() {
  const container = document.getElementById('message-container');
  if (!container) return;

  try {
    const res = await fetch('/api/messages');
    const data = await res.json();

    if (!data.messages || data.messages.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--text-sub);">現在、届いているお知らせはありません。</p>';
      return;
    }

    container.innerHTML = data.messages.map(msg => {
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

  } catch (err) {
    console.error('メッセージ読み込みエラー:', err);
    container.innerHTML = '<p style="text-align: center; color: red;">メッセージの読み込みに失敗しました。</p>';
  }
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

document.addEventListener('DOMContentLoaded', () => {
  checkIOS();
  registerServiceWorker();
  updateUIStatus();
  loadMessages();

  const subBtn = document.getElementById('subscribe-btn');
  if (subBtn) subBtn.addEventListener('click', subscribeUser);
});

// 内省 Naisei Journal — Service Worker
const CACHE_NAME = 'naisei-v1';
const FONTS_CACHE = 'naisei-fonts-v1';

// オフラインで動作させるファイル
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// Googleフォント（別キャッシュで管理）
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// Firebase・Claude API（ネットワーク優先）
const NETWORK_FIRST_ORIGINS = [
  'https://api.anthropic.com',
  'https://identitytoolkit.googleapis.com',
  'https://firestore.googleapis.com',
  'https://www.googleapis.com',
  'https://securetoken.googleapis.com',
];

// ── インストール：静的ファイルをキャッシュ ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート：古いキャッシュを削除 ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONTS_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── フェッチ戦略 ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Claude API・Firebase → ネットワーク優先（オフライン時はエラー許容）
  if (NETWORK_FIRST_ORIGINS.some(o => event.request.url.startsWith(o))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Googleフォント → キャッシュ優先（初回はネットワーク取得・以降オフライン）
  if (FONT_ORIGINS.some(o => event.request.url.startsWith(o))) {
    event.respondWith(
      caches.open(FONTS_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Firebase JS SDK（CDN）→ キャッシュ優先
  if (event.request.url.includes('firebasejs') ||
      event.request.url.includes('gstatic.com/firebasejs')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // その他（アプリ本体）→ キャッシュ優先・なければネットワーク
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 成功したレスポンスはキャッシュに追加
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // オフライン時のフォールバック
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── バックグラウンド同期（将来の拡張用） ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

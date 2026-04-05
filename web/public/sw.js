// Service worker — offline fallback for PWA
const CACHE_NAME = 'claude-code-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only handle navigation requests with offline fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(
                    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{background:#0a0a0a;color:#fafafa;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}.c{max-width:300px}h2{color:#f97316;margin-bottom:8px}p{color:#999;font-size:14px}button{margin-top:16px;padding:10px 24px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}</style></head><body><div class="c"><h2>Offline</h2><p>Cannot reach Claude Code server.</p><button onclick="location.reload()">Retry</button></div></body></html>',
                    { headers: { 'Content-Type': 'text/html' } }
                );
            })
        );
    }
});

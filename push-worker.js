importScripts('./push-route.js?v=wish1');
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  const message = event.data?.json() || {};
  const route = pushRoute(message.page,message.anchor);
  event.waitUntil(self.registration.showNotification(message.title || 'Великий покоритель сердца', {
    body: message.body || 'Открой игру, чтобы посмотреть обновления.',
    icon: new URL('icon-192.png', self.registration.scope).href,
    tag: message.tag,
    data: route
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const {page,anchor} = pushRoute(event.notification.data?.page,event.notification.data?.anchor);
    const target = new URL('./', self.registration.scope);
    target.hash = anchor ? page + '/' + anchor : page;
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const existing = windows.find(w => {
      const url = new URL(w.url);
      return url.origin === target.origin && (url.pathname === target.pathname || url.pathname === target.pathname+'index.html');
    });
    if (existing) {
      await existing.focus();
      existing.postMessage({type:'heart-open', page, anchor});
    } else await self.clients.openWindow(target.href);
  })());
});

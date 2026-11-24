self.addEventListener('push', event => {
  const message = event.data?.json() || {};
  const page = message.page === 'quests' ? 'quests' : 'home';
  event.waitUntil(self.registration.showNotification(message.title || 'Великий покоритель сердца', {
    body: message.body || 'Открой игру, чтобы посмотреть обновления.',
    icon: new URL('icon-192.png', self.registration.scope).href,
    tag: message.tag,
    data: {page}
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const page = event.notification.data?.page === 'quests' ? 'quests' : 'home';
    const target = new URL('./#' + page, self.registration.scope);
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const existing = windows.find(w => {
      const url = new URL(w.url);
      return url.origin === target.origin && (url.pathname === target.pathname || url.pathname === target.pathname+'index.html');
    });
    if (existing) {
      await existing.focus();
      existing.postMessage({type:'heart-open', page});
    } else await self.clients.openWindow(target.href);
  })());
});

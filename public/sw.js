/*
 * The DramaScan browser push service worker.
 *
 * The browser needs a service worker to hold a push subscription, and this one
 * does exactly two things: show a notification when a push message arrives, and
 * open the linked page when the viewer clicks it.
 *
 * It is deliberately tiny. There is no background sync, no cache, no
 * precaching, and no work: the application is a server-rendered site, and the
 * worker exists only to receive pushes.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: 'DramaScan',
      body: event.data ? event.data.text() : '',
    };
  }

  const title = typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : 'DramaScan';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const link = typeof payload.link === 'string' && payload.link.length > 0 ? payload.link : '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { link },
      tag: typeof payload.collapseKey === 'string' ? payload.collapseKey : undefined,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data;
  const link = data && typeof data.link === 'string' && data.link.length > 0 ? data.link : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }

      return self.clients.openWindow(link);
    })
  );
});

// Remplace l'ancien service worker de la web app : il vide ses caches, se desinscrit
// et envoie les onglets ouverts vers la nouvelle adresse.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.navigate('https://porest.poksol.com/' + new URL(client.url).hash);
    }
  })());
});

// Deixa a gestão da 7A instalável como app. Não guarda dados offline: tudo vem sempre do servidor.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

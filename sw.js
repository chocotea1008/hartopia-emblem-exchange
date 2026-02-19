self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
    const targetUrl = event.notification?.data?.url || "./";
    event.notification.close();

    event.waitUntil(
        (async () => {
            const clients = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });

            for (const client of clients) {
                if ("focus" in client) {
                    if ("navigate" in client) {
                        try {
                            await client.navigate(targetUrl);
                        } catch {
                            // ignore navigate failures and still focus
                        }
                    }
                    await client.focus();
                    return;
                }
            }

            if (self.clients.openWindow) {
                await self.clients.openWindow(targetUrl);
            }
        })(),
    );
});

self.addEventListener("push", (event) => {
    if (!event.data) {
        return;
    }

    let payload = {};
    try {
        payload = event.data.json();
    } catch {
        payload = { body: event.data.text() };
    }

    const title = payload.title || "새 알림";
    const body = payload.body || "";
    const url = payload.url || payload.click_action || "./";
    const tag = payload.tag || undefined;

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            tag,
            data: { url },
            renotify: Boolean(tag),
        }),
    );
});

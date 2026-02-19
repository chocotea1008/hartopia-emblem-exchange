const SERVICE_WORKER_PATH = "sw.js";

let workerRegistrationPromise = null;

function supportsNotification() {
    return "Notification" in window;
}

function supportsServiceWorker() {
    return "serviceWorker" in navigator && window.isSecureContext;
}

export async function ensureNotificationWorker() {
    if (!supportsServiceWorker()) {
        return null;
    }

    if (!workerRegistrationPromise) {
        workerRegistrationPromise = navigator.serviceWorker
            .register(SERVICE_WORKER_PATH, { scope: "./" })
            .then(async (registration) => {
                try {
                    await navigator.serviceWorker.ready;
                } catch {
                    // use the current registration as fallback
                }
                return registration;
            })
            .catch((error) => {
                workerRegistrationPromise = null;
                throw error;
            });
    }

    try {
        return await workerRegistrationPromise;
    } catch (error) {
        console.error("notification worker registration failed:", error);
        return null;
    }
}

export async function showSystemNotification(title, options = {}) {
    if (!supportsNotification() || Notification.permission !== "granted") {
        return false;
    }

    const body = typeof options.body === "string" ? options.body : "";
    const tag = typeof options.tag === "string" ? options.tag : undefined;
    const targetUrl =
        typeof options.url === "string" && options.url.length > 0
            ? options.url
            : window.location.href;

    const registration = await ensureNotificationWorker();
    if (registration && typeof registration.showNotification === "function") {
        await registration.showNotification(title, {
            body,
            tag,
            renotify: Boolean(tag),
            data: {
                url: targetUrl,
            },
        });
        return true;
    }

    const notification = new Notification(title, {
        body,
        tag,
        data: {
            url: targetUrl,
        },
    });
    notification.onclick = () => {
        window.focus();
        if (targetUrl) {
            window.location.href = targetUrl;
        }
    };
    return true;
}

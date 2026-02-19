import { ensureNotificationWorker } from "./notify.js";

const OVERLAY_ID = "notification-required-overlay";
const STYLE_ID = "notification-required-style";

let pendingPermissionPromise = null;
let resolvePermission = null;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${OVERLAY_ID} {
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: rgba(12, 20, 37, 0.88);
            backdrop-filter: blur(4px);
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        #${OVERLAY_ID}.active {
            display: flex;
        }

        #${OVERLAY_ID} .permission-card {
            width: min(420px, 100%);
            background: #ffffff;
            border: 3px solid #fff;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
            padding: 24px;
            text-align: center;
            font-family: "Pretendard Variable", Pretendard, sans-serif;
        }

        #${OVERLAY_ID} .permission-title {
            margin: 0;
            color: #1f2937;
            font-size: 1.25rem;
            font-weight: 800;
            line-height: 1.5;
        }

        #${OVERLAY_ID} .permission-desc {
            margin: 12px 0 0;
            color: #4b5563;
            font-size: 0.95rem;
            font-weight: 600;
            line-height: 1.6;
        }

        #${OVERLAY_ID} .permission-btn {
            margin-top: 18px;
            width: 100%;
            border: none;
            border-radius: 14px;
            padding: 13px 14px;
            font-size: 1rem;
            font-weight: 800;
            color: #fff;
            background: linear-gradient(135deg, #ff477e 0%, #ff7096 100%);
            cursor: pointer;
        }

        #${OVERLAY_ID} .permission-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    `;

    document.head.appendChild(style);
}

function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
        <div class="permission-card" role="dialog" aria-modal="true" aria-labelledby="permission-title">
            <h2 class="permission-title" id="permission-title">원활한 매칭을 위해 알림 권한이 필수입니다.</h2>
            <p class="permission-desc" id="permission-desc">권한을 허용하면 실시간 매칭 알림을 받을 수 있습니다.</p>
            <button type="button" class="permission-btn" id="permission-allow-btn">권한 허용하기</button>
        </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
}

function showOverlay(message) {
    ensureStyles();
    const overlay = ensureOverlay();
    const desc = overlay.querySelector("#permission-desc");
    if (desc && message) {
        desc.textContent = message;
    }
    overlay.classList.add("active");
}

function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
        return;
    }
    overlay.classList.remove("active");
}

async function requestNotificationPermission() {
    const permission = await Notification.requestPermission();
    return permission;
}

export async function ensureNotificationPermission() {
    if (!("Notification" in window)) {
        throw new Error("이 브라우저는 알림 기능을 지원하지 않습니다.");
    }

    if (Notification.permission === "granted") {
        hideOverlay();
        ensureNotificationWorker().catch(console.error);
        return true;
    }

    showOverlay("권한 허용 전까지 서비스 이용이 제한됩니다.");
    const overlay = ensureOverlay();
    const button = overlay.querySelector("#permission-allow-btn");
    const desc = overlay.querySelector("#permission-desc");

    if (!pendingPermissionPromise) {
        pendingPermissionPromise = new Promise((resolve) => {
            resolvePermission = resolve;
        });
    }

    button.onclick = async () => {
        button.disabled = true;
        try {
            const permission = await requestNotificationPermission();
            if (permission === "granted") {
                hideOverlay();
                if (resolvePermission) {
                    resolvePermission(true);
                    resolvePermission = null;
                    pendingPermissionPromise = null;
                }
                ensureNotificationWorker().catch(console.error);
                return;
            }

            if (desc) {
                desc.textContent =
                    permission === "denied"
                        ? "알림이 차단되었습니다. 브라우저 설정에서 알림을 허용한 뒤 다시 시도해주세요."
                        : "권한 허용 후 이용할 수 있습니다.";
            }
        } catch (error) {
            if (desc) {
                desc.textContent = "권한 요청 중 오류가 발생했습니다. 다시 시도해주세요.";
            }
            console.error(error);
        } finally {
            button.disabled = false;
        }
    };

    return pendingPermissionPromise;
}

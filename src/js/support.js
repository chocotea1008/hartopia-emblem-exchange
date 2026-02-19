import { ensureNotificationPermission } from "./permission.js";
import { initAnonymousAuth } from "./auth.js";
import {
    findLatestOpenChatForUser,
    getPartnerIdFromChat,
    watchIncomingTradeRequests,
} from "./match.js";

const CHAT_RECOVERY_POLL_MS = 1500;

const state = {
    uid: null,
    isRedirecting: false,
    unsubscribeRequests: null,
    recoveryTimer: null,
    visibilityHandler: null,
};

function setBackLink() {
    const backLink = document.getElementById("back-link");
    if (!backLink) {
        return;
    }

    const referrer = document.referrer;
    if (referrer && referrer.includes(location.host)) {
        backLink.href = referrer;
    } else {
        backLink.href = "index.html";
    }
}

function buildChatUrl(chatData) {
    const partnerId = getPartnerIdFromChat(chatData, state.uid);
    return `chat.html?chatId=${encodeURIComponent(chatData.chatId)}${
        partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ""
    }`;
}

function openChat(chatData) {
    if (!chatData || !chatData.chatId || state.isRedirecting) {
        return;
    }

    state.isRedirecting = true;
    window.location.href = buildChatUrl(chatData);
}

async function maybeOpenExistingChat() {
    if (!state.uid || state.isRedirecting) {
        return false;
    }

    try {
        const chatData = await findLatestOpenChatForUser(state.uid);
        if (!chatData || state.isRedirecting) {
            return false;
        }
        openChat(chatData);
        return true;
    } catch (error) {
        console.error("support chat recovery failed:", error);
        return false;
    }
}

function startRecoveryPoll() {
    if (state.recoveryTimer || !state.uid) {
        return;
    }
    maybeOpenExistingChat().catch(console.error);
    state.recoveryTimer = setInterval(() => {
        maybeOpenExistingChat().catch(console.error);
    }, CHAT_RECOVERY_POLL_MS);
}

function bindVisibilityRecovery() {
    if (state.visibilityHandler) {
        return;
    }
    state.visibilityHandler = () => {
        if (!document.hidden) {
            maybeOpenExistingChat().catch(console.error);
        }
    };
    document.addEventListener("visibilitychange", state.visibilityHandler);
}

function listenIncomingRequests() {
    if (state.unsubscribeRequests) {
        state.unsubscribeRequests();
    }
    state.unsubscribeRequests = watchIncomingTradeRequests(
        state.uid,
        (chatData) => {
            openChat(chatData);
        },
        { emitInitial: false },
    );
}

async function init() {
    setBackLink();

    try {
        await ensureNotificationPermission();
        const { uid } = await initAnonymousAuth();
        state.uid = uid;

        const redirected = await maybeOpenExistingChat();
        if (redirected) {
            return;
        }

        listenIncomingRequests();
        bindVisibilityRecovery();
        startRecoveryPoll();
    } catch (error) {
        console.error("support init failed:", error);
    }
}

init();

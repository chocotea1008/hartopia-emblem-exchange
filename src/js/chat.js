import { items } from "../../js/data.js";
import { db } from "../../firebase-config.js";
import {
    addDoc,
    collection,
    deleteField,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ensureNotificationPermission } from "./permission.js";
import { initAnonymousAuth, setUserStatus } from "./auth.js";
import { buildChatId, findLatestOpenChatForUser } from "./match.js";
import { getInitErrorHint } from "./error-hints.js";

const CHAT_OPENED_MESSAGE = "채팅방이 열렸습니다.";
const CHAT_CANCELED_MESSAGE = "채팅이 닫혀 교환이 취소되었습니다.";
const TRADE_COMPLETED_MESSAGE = "거래가 종료되었습니다. 나가셔도 좋습니다.";
const PRESENCE_NOTICE_DURATION_MS = 4000;
const MATCH_TTL_MS = 24 * 60 * 60 * 1000;

const elements = {
    messageList: document.getElementById("message-list"),
    chatInput: document.getElementById("chat-input"),
    sendBtn: document.getElementById("send-btn"),
    partnerName: document.getElementById("partner-name-display"),
    partnerStatus: document.getElementById("partner-status-display"),
    presenceNotice: document.getElementById("presence-notice"),
    giveContainer: document.querySelector("#chat-give-items .badge-row-chat"),
    getContainer: document.querySelector("#chat-get-items .badge-row-chat"),
    backBtn: document.getElementById("chat-back-btn"),
    exitModal: document.getElementById("exit-modal"),
    modalNo: document.getElementById("modal-no"),
    modalYes: document.getElementById("modal-yes"),
    completeBtn: document.getElementById("chat-complete-btn"),
};

const state = {
    uid: null,
    nickname: "",
    partnerId: null,
    chatId: null,
    chatRef: null,
    currentChatData: null,
    unsubscribeChat: null,
    unsubscribeMessages: null,
    unsubscribePartnerPresence: null,
    partnerPresenceUid: null,
    partnerWasOnline: null,
    presenceNoticeTimer: null,
    isRouting: false,
    isCancelling: false,
    isTradeHandled: false,
    closeSignalSent: false,
    navigationGuardActive: false,
    lastBackBlockedAt: 0,
};

function unique(items) {
    return [...new Set(Array.isArray(items) ? items : [])];
}

function toMillis(timestampLike) {
    if (!timestampLike) {
        return 0;
    }
    if (typeof timestampLike.toMillis === "function") {
        return timestampLike.toMillis();
    }
    if (timestampLike.seconds !== undefined) {
        return timestampLike.seconds * 1000;
    }
    if (timestampLike instanceof Date) {
        return timestampLike.getTime();
    }
    const parsed = Date.parse(timestampLike);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isExpired(matchingStartedAt) {
    const startedAtMs = toMillis(matchingStartedAt);
    if (!startedAtMs) {
        return true;
    }
    return Date.now() - startedAtMs > MATCH_TTL_MS;
}

function derivePresence(data) {
    if (data?.presence === "online" || data?.presence === "offline") {
        return data.presence;
    }
    return data?.status === "offline" ? "offline" : "online";
}

function deriveActivity(data) {
    if (
        data?.activity === "idle" ||
        data?.activity === "matching" ||
        data?.activity === "trading"
    ) {
        return data.activity;
    }
    if (data?.status === "matching" || data?.status === "trading") {
        return data.status;
    }
    return "idle";
}

async function hasAvailableMatchesForCurrentUser() {
    const mySnapshot = await getDoc(doc(db, "users", state.uid));
    if (!mySnapshot.exists()) {
        return false;
    }

    const myData = mySnapshot.data();
    const myGiveItems = unique(myData.giveItems);
    const myGetItems = unique(myData.getItems);
    if (myGiveItems.length === 0 || myGetItems.length === 0) {
        return false;
    }

    const myGiveSet = new Set(myGiveItems);
    const myGetSet = new Set(myGetItems);
    const matchingUsersSnapshot = await getDocs(
        query(collection(db, "users"), where("activity", "==", "matching")),
    );

    for (const userDoc of matchingUsersSnapshot.docs) {
        if (userDoc.id === state.uid) {
            continue;
        }

        const candidate = userDoc.data();
        if (deriveActivity(candidate) !== "matching") {
            continue;
        }
        if (isExpired(candidate.matchingStartedAt)) {
            continue;
        }

        const theirGiveItems = unique(candidate.giveItems);
        const theirGetItems = unique(candidate.getItems);
        const hasGetMatch = theirGiveItems.some((itemId) => myGetSet.has(itemId));
        const hasGiveMatch = theirGetItems.some((itemId) => myGiveSet.has(itemId));
        if (hasGetMatch && hasGiveMatch) {
            return true;
        }
    }

    return false;
}

function getItemInfo(id) {
    const found = items.find((item) => item.id === id);
    if (!found) {
        return null;
    }
    return {
        src: found.src,
        label: found.categoryLabel
            ? `${found.categoryLabel} ${found.number}`
            : `${found.category ?? ""} ${found.number ?? ""}`.trim(),
    };
}

function resolvePartnerName() {
    if (!state.partnerId) {
        return "교환 파트너";
    }
    return state.currentChatData?.participantNicknames?.[state.partnerId] ?? "교환 파트너";
}

function setPartnerStatusText(isOnline) {
    if (!elements.partnerStatus) {
        return;
    }
    elements.partnerStatus.textContent = isOnline ? "온라인" : "오프라인";
    elements.partnerStatus.classList.toggle("is-online", isOnline);
    elements.partnerStatus.classList.toggle("is-offline", !isOnline);
}

function disableNavigationGuard() {
    if (!state.navigationGuardActive) {
        return;
    }
    window.removeEventListener("popstate", handleBrowserBackBlocked);
    state.navigationGuardActive = false;
}

function notifyBackBlocked() {
    const now = Date.now();
    if (now - state.lastBackBlockedAt < 1500) {
        return;
    }
    state.lastBackBlockedAt = now;
    alert("채팅 중에는 화면의 뒤로가기 버튼을 사용해주세요.");
}

function handleBrowserBackBlocked() {
    if (state.isTradeHandled || state.isRouting || state.isCancelling) {
        return;
    }
    try {
        window.history.pushState({ chatGuard: true }, "", window.location.href);
    } catch {
        // ignore pushState failures
    }
    notifyBackBlocked();
}

function enableNavigationGuard() {
    if (state.navigationGuardActive) {
        return;
    }
    try {
        window.history.pushState({ chatGuard: true }, "", window.location.href);
    } catch {
        // ignore pushState failures
    }
    window.addEventListener("popstate", handleBrowserBackBlocked);
    state.navigationGuardActive = true;
}

function showPresenceNotice(text) {
    if (!elements.presenceNotice) {
        return;
    }

    elements.presenceNotice.textContent = text;
    elements.presenceNotice.classList.add("active");

    if (state.presenceNoticeTimer) {
        clearTimeout(state.presenceNoticeTimer);
    }
    state.presenceNoticeTimer = setTimeout(() => {
        if (!elements.presenceNotice) {
            return;
        }
        elements.presenceNotice.classList.remove("active");
        elements.presenceNotice.textContent = "";
        state.presenceNoticeTimer = null;
    }, PRESENCE_NOTICE_DURATION_MS);
}

function subscribePartnerPresence() {
    if (!state.partnerId || !state.chatRef) {
        return;
    }
    if (state.partnerPresenceUid === state.partnerId && state.unsubscribePartnerPresence) {
        return;
    }
    if (state.unsubscribePartnerPresence) {
        state.unsubscribePartnerPresence();
        state.unsubscribePartnerPresence = null;
    }

    state.partnerPresenceUid = state.partnerId;
    state.partnerWasOnline = null;
    state.unsubscribePartnerPresence = onSnapshot(
        doc(db, "users", state.partnerId),
        (snapshot) => {
            if (!snapshot.exists()) {
                return;
            }

            const partnerData = snapshot.data();
            const isOnline = derivePresence(partnerData) === "online";
            setPartnerStatusText(isOnline);

            if (state.partnerWasOnline === null) {
                state.partnerWasOnline = isOnline;
                return;
            }

            if (!state.partnerWasOnline && isOnline) {
                showPresenceNotice(`${resolvePartnerName()}님이 접속했습니다.`);
            }
            state.partnerWasOnline = isOnline;
        },
    );
}

function stopRealtimeListeners() {
    if (state.unsubscribeChat) {
        state.unsubscribeChat();
        state.unsubscribeChat = null;
    }
    if (state.unsubscribeMessages) {
        state.unsubscribeMessages();
        state.unsubscribeMessages = null;
    }
    if (state.unsubscribePartnerPresence) {
        state.unsubscribePartnerPresence();
        state.unsubscribePartnerPresence = null;
    }
    state.partnerPresenceUid = null;
    state.partnerWasOnline = null;
    if (state.presenceNoticeTimer) {
        clearTimeout(state.presenceNoticeTimer);
        state.presenceNoticeTimer = null;
    }
    if (elements.presenceNotice) {
        elements.presenceNotice.classList.remove("active");
        elements.presenceNotice.textContent = "";
    }
}

function setChatInputEnabled(enabled) {
    if (elements.chatInput) {
        elements.chatInput.disabled = !enabled;
    }
    if (elements.sendBtn) {
        elements.sendBtn.disabled = !enabled;
        elements.sendBtn.style.opacity = enabled ? "1" : "0.5";
    }
}

function updateCompleteButtonState(chatData) {
    if (!elements.completeBtn) {
        return;
    }

    const participants = Array.isArray(chatData?.participants)
        ? chatData.participants.filter((id) => typeof id === "string" && id.length > 0)
        : [];
    const completedBy = chatData?.completedBy ?? {};
    const myCompleted = Boolean(completedBy[state.uid]);
    const allCompleted =
        participants.length >= 2 && participants.every((id) => Boolean(completedBy[id]));
    const disabled = Boolean(chatData?.isCanceled || chatData?.isCompleted);

    elements.completeBtn.disabled = disabled;
    elements.completeBtn.classList.toggle(
        "is-confirmed",
        myCompleted || allCompleted || Boolean(chatData?.isCompleted),
    );
    elements.completeBtn.setAttribute("aria-pressed", myCompleted ? "true" : "false");
}

function renderItemStack(itemIds, container) {
    if (!container) {
        return;
    }
    container.innerHTML = "";
    for (const itemId of itemIds ?? []) {
        const info = getItemInfo(itemId);
        if (!info) {
            continue;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "mini-item-chat";

        const image = document.createElement("img");
        image.src = info.src;
        image.alt = info.label;
        image.className = "mini-badge-chat";

        const label = document.createElement("span");
        label.className = "chat-item-label";
        label.textContent = info.label;

        wrapper.appendChild(image);
        wrapper.appendChild(label);
        container.appendChild(wrapper);
    }
}

function hideExitModal() {
    if (elements.exitModal) {
        elements.exitModal.classList.remove("active");
    }
}

function addMessageBubble(message) {
    if (!elements.messageList) {
        return;
    }

    const isSystem = message.type === "system";
    const isMe = message.senderId === state.uid && !isSystem;

    const row = document.createElement("div");
    row.className = `msg-row ${
        isSystem ? "msg-row-system" : isMe ? "msg-row-me" : "msg-row-partner"
    }`;

    const bubble = document.createElement("div");
    bubble.className = `msg-bubble ${isSystem ? "msg-system" : isMe ? "msg-me" : "msg-partner"}`;

    const createdAt = message.createdAt?.toDate
        ? message.createdAt.toDate()
        : new Date();
    const time = createdAt.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
    });

    const textNode = document.createElement("div");
    textNode.className = "msg-text";
    textNode.textContent = message.text ?? "";
    bubble.appendChild(textNode);

    const timeNode = document.createElement("span");
    timeNode.className = "msg-time";
    timeNode.textContent = time;

    if (isMe) {
        row.appendChild(timeNode);
        row.appendChild(bubble);
    } else {
        row.appendChild(bubble);
        row.appendChild(timeNode);
    }

    elements.messageList.appendChild(row);
}

function renderMessages(messages) {
    if (!elements.messageList) {
        return;
    }
    elements.messageList.innerHTML = "";
    for (const message of messages) {
        addMessageBubble(message);
    }
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function getInitiatorId(chatData) {
    if (typeof chatData?.initiatorId === "string" && chatData.initiatorId.length > 0) {
        return chatData.initiatorId;
    }
    if (
        typeof chatData?.lastSenderId === "string" &&
        typeof chatData?.lastMessage === "string" &&
        chatData.lastMessage.includes(CHAT_OPENED_MESSAGE)
    ) {
        return chatData.lastSenderId;
    }
    return null;
}

function buildChatUrl(chatId, partnerId) {
    return `chat.html?chatId=${encodeURIComponent(chatId)}${
        partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ""
    }`;
}

async function navigateWithStatus(status, targetUrl) {
    if (state.isRouting) {
        return;
    }
    state.isRouting = true;
    disableNavigationGuard();
    stopRealtimeListeners();

    try {
        await setUserStatus(state.uid, status);
    } catch (error) {
        console.error("failed to update status before navigation:", error);
    } finally {
        window.location.href = targetUrl;
    }
}

async function routeAfterCancellation(chatData, showAlert) {
    const initiatorId = getInitiatorId(chatData);
    const iAmInitiator = initiatorId === state.uid;
    let targetUrl = "index.html";
    let targetStatus = "online";

    if (!iAmInitiator) {
        let hasMatchCandidate = true;
        try {
            hasMatchCandidate = await hasAvailableMatchesForCurrentUser();
        } catch (error) {
            console.error("failed to check remaining match candidates:", error);
        }

        if (hasMatchCandidate) {
            targetUrl = "exchange.html";
            targetStatus = "matching";
        }
    }

    if (showAlert) {
        if (iAmInitiator || targetUrl === "index.html") {
            alert("채팅이 닫혀 교환이 취소되었습니다. 메인으로 이동합니다.");
        } else {
            alert("채팅이 닫혀 교환이 취소되었습니다. 매칭 상태로 돌아갑니다.");
        }
    }

    await navigateWithStatus(targetStatus, targetUrl);
}

async function handleCanceledTrade(chatData, showAlert = true) {
    if (state.isTradeHandled) {
        return;
    }
    state.isTradeHandled = true;
    setChatInputEnabled(false);
    updateCompleteButtonState(chatData);
    await routeAfterCancellation(chatData, showAlert);
}

async function handleCompletedTrade(chatData) {
    if (state.isTradeHandled) {
        return;
    }
    state.isTradeHandled = true;
    setChatInputEnabled(false);
    updateCompleteButtonState(chatData);
    alert(TRADE_COMPLETED_MESSAGE);
    await navigateWithStatus("online", "index.html");
}

async function sendMessage() {
    if (!state.chatRef || !elements.chatInput || state.isTradeHandled) {
        return;
    }

    const text = elements.chatInput.value.trim();
    if (!text) {
        return;
    }

    await addDoc(collection(state.chatRef, "messages"), {
        senderId: state.uid,
        text,
        type: "text",
        createdAt: serverTimestamp(),
    });

    await updateDoc(state.chatRef, {
        lastMessage: text,
        lastSenderId: state.uid,
        updatedAt: serverTimestamp(),
    });

    elements.chatInput.value = "";
    if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
        document.activeElement !== elements.chatInput
    ) {
        elements.chatInput.focus();
    }
}

async function maybeFinalizeTrade(chatData) {
    if (!state.chatRef || chatData?.isCompleted || chatData?.isCanceled) {
        return;
    }

    const participants = Array.isArray(chatData?.participants)
        ? chatData.participants.filter((id) => typeof id === "string" && id.length > 0)
        : [];
    if (participants.length < 2) {
        return;
    }

    const completedBy = chatData?.completedBy ?? {};
    const allCompleted = participants.every((id) => Boolean(completedBy[id]));
    if (!allCompleted) {
        return;
    }

    const finalized = await runTransaction(db, async (tx) => {
        const snap = await tx.get(state.chatRef);
        if (!snap.exists()) {
            return false;
        }

        const latest = snap.data();
        if (latest.isCompleted || latest.isCanceled) {
            return false;
        }

        const latestParticipants = Array.isArray(latest.participants)
            ? latest.participants.filter((id) => typeof id === "string" && id.length > 0)
            : [];
        const latestCompletedBy = latest.completedBy ?? {};
        const latestAllCompleted =
            latestParticipants.length >= 2 &&
            latestParticipants.every((id) => Boolean(latestCompletedBy[id]));
        if (!latestAllCompleted) {
            return false;
        }

        tx.update(state.chatRef, {
            isCompleted: true,
            chatOpened: false,
            lastMessage: TRADE_COMPLETED_MESSAGE,
            lastSenderId: state.uid,
            updatedAt: serverTimestamp(),
            completedAt: serverTimestamp(),
        });
        return true;
    });

    if (finalized) {
        await addDoc(collection(state.chatRef, "messages"), {
            senderId: state.uid,
            text: TRADE_COMPLETED_MESSAGE,
            type: "system",
            createdAt: serverTimestamp(),
        });
    }
}

async function completeTrade() {
    if (!state.chatRef || state.isTradeHandled) {
        return;
    }

    const chatData = state.currentChatData;
    if (chatData?.isCompleted || chatData?.isCanceled) {
        return;
    }

    if (chatData?.completedBy?.[state.uid]) {
        const unmarkMessage = `${state.nickname}님이 교환 완료를 취소했습니다.`;
        await updateDoc(state.chatRef, {
            [`completedBy.${state.uid}`]: deleteField(),
            lastMessage: unmarkMessage,
            lastSenderId: state.uid,
            updatedAt: serverTimestamp(),
        });

        await addDoc(collection(state.chatRef, "messages"), {
            senderId: state.uid,
            text: unmarkMessage,
            type: "system",
            createdAt: serverTimestamp(),
        });
        return;
    }

    const waitingMessage = `${state.nickname}님이 교환 완료를 눌렀습니다.`;
    await updateDoc(state.chatRef, {
        [`completedBy.${state.uid}`]: true,
        lastMessage: waitingMessage,
        lastSenderId: state.uid,
        updatedAt: serverTimestamp(),
    });

    await addDoc(collection(state.chatRef, "messages"), {
        senderId: state.uid,
        text: waitingMessage,
        type: "system",
        createdAt: serverTimestamp(),
    });
}

async function cancelTradeByUser() {
    if (!state.chatRef || state.isTradeHandled || state.isCancelling) {
        return;
    }

    state.isCancelling = true;
    hideExitModal();

    try {
        let chatData = state.currentChatData;
        if (!chatData) {
            const snapshot = await getDoc(state.chatRef);
            chatData = snapshot.exists() ? snapshot.data() : null;
        }
        if (!chatData) {
            await navigateWithStatus("online", "index.html");
            return;
        }

        if (chatData.isCompleted) {
            await handleCompletedTrade(chatData);
            return;
        }
        if (chatData.isCanceled) {
            await handleCanceledTrade(chatData, false);
            return;
        }

        state.closeSignalSent = true;
        await updateDoc(state.chatRef, {
            isCanceled: true,
            chatOpened: false,
            canceledBy: state.uid,
            canceledAt: serverTimestamp(),
            lastMessage: CHAT_CANCELED_MESSAGE,
            lastSenderId: state.uid,
            updatedAt: serverTimestamp(),
        });

        await addDoc(collection(state.chatRef, "messages"), {
            senderId: state.uid,
            text: CHAT_CANCELED_MESSAGE,
            type: "system",
            createdAt: serverTimestamp(),
        });

        await handleCanceledTrade(
            {
                ...chatData,
                isCanceled: true,
                canceledBy: state.uid,
            },
            false,
        );
    } catch (error) {
        console.error("failed to cancel trade:", error);
        alert("채팅 종료 처리 중 오류가 발생했습니다.");
    } finally {
        state.isCancelling = false;
    }
}

function bindEvents() {
    if (elements.sendBtn) {
        const handleSendPress = (event) => {
            event.preventDefault();
            sendMessage().catch(console.error);
        };

        if ("PointerEvent" in window) {
            elements.sendBtn.addEventListener("pointerdown", handleSendPress);
        } else {
            elements.sendBtn.addEventListener("mousedown", handleSendPress);
            elements.sendBtn.addEventListener("touchstart", handleSendPress, {
                passive: false,
            });
        }
    }

    if (elements.chatInput) {
        elements.chatInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                sendMessage().catch(console.error);
            }
        });
    }

    if (elements.backBtn && elements.exitModal) {
        elements.backBtn.addEventListener("click", () => {
            elements.exitModal.classList.add("active");
        });
    }

    if (elements.modalNo) {
        elements.modalNo.addEventListener("click", hideExitModal);
    }

    if (elements.modalYes) {
        elements.modalYes.addEventListener("click", () => {
            cancelTradeByUser().catch(console.error);
        });
    }

    if (elements.completeBtn) {
        elements.completeBtn.addEventListener("click", () => {
            completeTrade().catch((error) => {
                console.error(error);
                alert("거래 완료 처리 중 오류가 발생했습니다.");
            });
        });
    }
}

function subscribeChat() {
    if (!state.chatRef) {
        return;
    }

    if (state.unsubscribeChat) {
        state.unsubscribeChat();
    }

    state.unsubscribeChat = onSnapshot(state.chatRef, (snapshot) => {
        if (!snapshot.exists()) {
            return;
        }

        const chatData = snapshot.data();
        state.currentChatData = chatData;

        if (!state.partnerId) {
            state.partnerId =
                (chatData.participants ?? []).find((uid) => uid !== state.uid) ?? null;
        }

        const partnerName = resolvePartnerName();
        if (elements.partnerName) {
            elements.partnerName.textContent = partnerName;
        }
        subscribePartnerPresence();

        const mySelection = chatData.selectionByUser?.[state.uid] ?? {
            giveItems: [],
            getItems: [],
        };
        renderItemStack(mySelection.giveItems, elements.giveContainer);
        renderItemStack(mySelection.getItems, elements.getContainer);

        const ended = Boolean(chatData.isCompleted || chatData.isCanceled);
        setChatInputEnabled(!ended);
        updateCompleteButtonState(chatData);

        if (chatData.isCanceled) {
            handleCanceledTrade(chatData).catch(console.error);
            return;
        }

        maybeFinalizeTrade(chatData).catch(console.error);

        if (chatData.isCompleted) {
            handleCompletedTrade(chatData).catch(console.error);
        }
    });
}

function subscribeMessages() {
    if (!state.chatRef) {
        return;
    }

    if (state.unsubscribeMessages) {
        state.unsubscribeMessages();
    }

    const messagesQuery = query(
        collection(state.chatRef, "messages"),
        orderBy("createdAt", "asc"),
    );
    state.unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
        const messages = snapshot.docs.map((messageDoc) => messageDoc.data());
        renderMessages(messages);
    });
}

function resolveChatContext() {
    const params = new URLSearchParams(window.location.search);
    let chatId = params.get("chatId");
    let partnerId = params.get("partnerId");

    if (!chatId) {
        const cached = localStorage.getItem("emblem.lastChat");
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                chatId = parsed.chatId ?? chatId;
                partnerId = parsed.partnerId ?? partnerId;
            } catch {
                // ignore malformed cache
            }
        }
    }

    if (!chatId && partnerId && state.uid) {
        chatId = buildChatId(state.uid, partnerId);
    }

    if (chatId && partnerId) {
        localStorage.setItem("emblem.lastChat", JSON.stringify({ chatId, partnerId }));
    }

    state.chatId = chatId;
    state.partnerId = partnerId;
}

async function ensureChatExists() {
    if (!state.chatRef) {
        return;
    }

    const payload = {
        participantNicknames: {
            [state.uid]: state.nickname,
        },
    };
    if (state.partnerId) {
        payload.participants = [state.uid, state.partnerId];
    }

    await setDoc(state.chatRef, payload, { merge: true });
}

async function init() {
    try {
        await ensureNotificationPermission();
        const { uid, nickname } = await initAnonymousAuth();
        state.uid = uid;
        state.nickname = nickname;
        setPartnerStatusText(false);

        resolveChatContext();
        if (!state.chatId) {
            const recoveredChat = await findLatestOpenChatForUser(state.uid);
            if (recoveredChat) {
                state.chatId = recoveredChat.chatId;
                state.partnerId =
                    (recoveredChat.participants ?? []).find((uid) => uid !== state.uid) ?? null;
            } else {
                alert("채팅 정보를 찾을 수 없습니다. 매칭 목록으로 이동합니다.");
                disableNavigationGuard();
                window.location.href = "exchange.html";
                return;
            }
        }

        await setUserStatus(state.uid, "trading");
        state.chatRef = doc(db, "chats", state.chatId);

        bindEvents();
        enableNavigationGuard();
        await ensureChatExists();
        setChatInputEnabled(true);
        updateCompleteButtonState(null);
        subscribeChat();
        subscribeMessages();
    } catch (error) {
        console.error("chat init failed:", error);
        alert(`채팅을 초기화하지 못했습니다.\n${getInitErrorHint(error)}`);
    }
}

init();

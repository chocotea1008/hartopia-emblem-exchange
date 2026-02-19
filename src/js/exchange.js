import { items } from "../../js/data.js";
import { db } from "../../firebase-config.js";
import {
    addDoc,
    collection,
    doc,
    serverTimestamp,
    setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ensureNotificationPermission } from "./permission.js";
import { initAnonymousAuth, setUserStatus } from "./auth.js";
import { getInitErrorHint } from "./error-hints.js";
import { showSystemNotification } from "./notify.js";
import {
    getSelection,
    hasValidSelection,
    loadSelectionFromStorage,
    saveSelection,
    saveSelectionToStorage,
} from "./db.js";
import {
    buildChatId,
    cancelMatching,
    findLatestOpenChatForUser,
    getPartnerIdFromChat,
    watchIncomingTradeRequests,
    watchPotentialMatches,
} from "./match.js";

const CHAT_OPENED_MESSAGE = "채팅방이 열렸습니다.";
const DEFAULT_PARTNER_NAME = "상대방";
const CHAT_RECOVERY_POLL_MS = 1500;

const elements = {
    backButton: document.getElementById("exchange-back-btn"),
    exchangeList: document.getElementById("exchange-list"),
};

const state = {
    uid: null,
    nickname: "",
    selection: { giveItems: [], getItems: [] },
    matches: [],
    unsubscribeMatches: null,
    unsubscribeRequests: null,
    isLeaving: false,
    isRedirectingToChat: false,
    chatRecoveryTimer: null,
    visibilityHandler: null,
};

function showNotification(title, body) {
    showSystemNotification(title, { body }).catch(console.error);
}

function getItemInfo(id) {
    const found = items.find((item) => item.id === id);
    if (!found) {
        return { src: "", number: "?", label: id };
    }

    const label = found.categoryLabel
        ? `${found.categoryLabel} ${found.number}`
        : `${found.category ?? ""} ${found.number ?? ""}`.trim();
    return {
        src: found.src,
        number: found.number,
        label,
    };
}

function renderEmpty(message) {
    if (!elements.exchangeList) {
        return;
    }

    elements.exchangeList.innerHTML = `
        <div class="empty-match">
            <span>🔍</span>
            <p>${message}</p>
        </div>
    `;
}

function createItemMiniCard(itemId) {
    const info = getItemInfo(itemId);
    return `
        <div class="mini-item-box">
            <img src="${info.src}" class="mini-badge" alt="${info.label}">
            <span class="item-label">${info.label}</span>
        </div>
    `;
}

function renderMatches() {
    if (!elements.exchangeList) {
        return;
    }

    if (!state.matches.length) {
        renderEmpty("현재 조건에 맞는 파트너가 없습니다. 잠시 후 다시 확인해주세요.");
        return;
    }

    elements.exchangeList.innerHTML = state.matches
        .map(
            (match) => `
            <div class="exchange-card" data-match-uid="${match.uid}">
                <div class="card-top">
                    <div class="user-meta">
                        <span class="user-name">👤 ${match.nickname}</span>
                        <span class="score-badge">${match.score}개 일치</span>
                    </div>
                    <span class="match-time">실시간</span>
                </div>
                <div class="card-body">
                    <div class="exchange-diagram">
                        <div class="item-group">
                            <span class="group-label label-give">내가 줄 것</span>
                            <div class="items-mini-grid">
                                ${match.giveItems.map((id) => createItemMiniCard(id)).join("")}
                            </div>
                        </div>
                        <div class="item-group">
                            <span class="group-label label-get">내가 받을 것</span>
                            <div class="items-mini-grid">
                                ${match.getItems.map((id) => createItemMiniCard(id)).join("")}
                            </div>
                        </div>
                    </div>
                    <div class="action-side">
                        <button class="request-btn" data-request-uid="${match.uid}">교환 요청</button>
                    </div>
                </div>
            </div>
        `,
        )
        .join("");
}

async function requestTrade(match) {
    const chatId = buildChatId(state.uid, match.uid);
    const chatRef = doc(db, "chats", chatId);
    const participants = [state.uid, match.uid];
    const participantNicknames = {
        [state.uid]: state.nickname,
        [match.uid]: match.nickname,
    };

    const selectionByUser = {
        [state.uid]: {
            giveItems: match.giveItems,
            getItems: match.getItems,
        },
        [match.uid]: {
            giveItems: match.getItems,
            getItems: match.giveItems,
        },
    };

    await setDoc(
        chatRef,
        {
            participants,
            participantNicknames,
            selectionByUser,
            initiatorId: state.uid,
            chatOpened: true,
            lastMessage: CHAT_OPENED_MESSAGE,
            lastSenderId: state.uid,
            updatedAt: serverTimestamp(),
            isCompleted: false,
            completedBy: {},
            isCanceled: false,
            canceledBy: null,
            canceledAt: null,
        },
        { merge: true },
    );

    await addDoc(collection(chatRef, "messages"), {
        senderId: state.uid,
        text: CHAT_OPENED_MESSAGE,
        type: "system",
        createdAt: serverTimestamp(),
    });

    await setUserStatus(state.uid, "trading");
    window.location.href = `chat.html?chatId=${encodeURIComponent(chatId)}&partnerId=${encodeURIComponent(match.uid)}`;
}

function bindRequestButtons() {
    if (!elements.exchangeList) {
        return;
    }

    elements.exchangeList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-request-uid]");
        if (!button) {
            return;
        }

        const targetUid = button.getAttribute("data-request-uid");
        const targetMatch = state.matches.find((match) => match.uid === targetUid);
        if (!targetMatch) {
            return;
        }

        requestTrade(targetMatch).catch((error) => {
            console.error(error);
            alert("채팅 열기 중 오류가 발생했습니다.");
        });
    });
}

function stopRealtimeListeners() {
    if (state.unsubscribeMatches) {
        state.unsubscribeMatches();
        state.unsubscribeMatches = null;
    }
    if (state.unsubscribeRequests) {
        state.unsubscribeRequests();
        state.unsubscribeRequests = null;
    }
    stopChatRecoveryPoll();
    if (state.visibilityHandler) {
        document.removeEventListener("visibilitychange", state.visibilityHandler);
        state.visibilityHandler = null;
    }
}

async function handleBackButtonClick() {
    if (state.isLeaving) {
        return;
    }

    state.isLeaving = true;
    if (elements.backButton) {
        elements.backButton.disabled = true;
    }

    stopRealtimeListeners();

    try {
        if (state.uid) {
            await cancelMatching(state.uid);
        }
    } catch (error) {
        console.error("failed to cancel matching before leaving:", error);
    } finally {
        window.location.href = "index.html";
    }
}

function bindBackButton() {
    if (!elements.backButton) {
        return;
    }

    elements.backButton.addEventListener("click", () => {
        handleBackButtonClick();
    });
}

function openIncomingChat(chatData) {
    if (state.isLeaving || state.isRedirectingToChat) {
        return;
    }

    const partnerId = getPartnerIdFromChat(chatData, state.uid);
    const partnerName = partnerId
        ? chatData.participantNicknames?.[partnerId] ?? DEFAULT_PARTNER_NAME
        : DEFAULT_PARTNER_NAME;
    const nextUrl = `chat.html?chatId=${encodeURIComponent(chatData.chatId)}${
        partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ""
    }`;

    showNotification(
        CHAT_OPENED_MESSAGE,
        `${partnerName}님이 채팅을 열었습니다.`,
        null,
    );

    state.isRedirectingToChat = true;
    stopRealtimeListeners();
    window.location.href = nextUrl;
}

function stopChatRecoveryPoll() {
    if (!state.chatRecoveryTimer) {
        return;
    }
    clearInterval(state.chatRecoveryTimer);
    state.chatRecoveryTimer = null;
}

async function maybeOpenExistingChat() {
    if (!state.uid || state.isLeaving || state.isRedirectingToChat) {
        return false;
    }

    try {
        const chatData = await findLatestOpenChatForUser(state.uid);
        if (!chatData || state.isLeaving || state.isRedirectingToChat) {
            return false;
        }
        openIncomingChat(chatData);
        return true;
    } catch (error) {
        console.error("failed to recover opened chat:", error);
        return false;
    }
}

function startChatRecoveryPoll() {
    if (!state.uid || state.chatRecoveryTimer) {
        return;
    }

    maybeOpenExistingChat().catch(console.error);
    state.chatRecoveryTimer = setInterval(() => {
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

    state.unsubscribeRequests = watchIncomingTradeRequests(state.uid, (chatData) => {
        openIncomingChat(chatData);
    });
}

function listenMatches() {
    if (state.unsubscribeMatches) {
        state.unsubscribeMatches();
    }

    state.unsubscribeMatches = watchPotentialMatches({
        uid: state.uid,
        giveItems: state.selection.giveItems,
        getItems: state.selection.getItems,
        onUpdate: (matches) => {
            state.matches = matches;
            localStorage.setItem("emblem.matches", JSON.stringify(matches));
            renderMatches();
        },
    });
}

async function resolveSelection() {
    let selection = loadSelectionFromStorage();
    if (!hasValidSelection(selection)) {
        selection = await getSelection(state.uid);
    }

    state.selection = selection;
    saveSelectionToStorage(selection);
    await saveSelection(state.uid, selection);
}

async function init() {
    try {
        await ensureNotificationPermission();
        const { uid, nickname } = await initAnonymousAuth();
        state.uid = uid;
        state.nickname = nickname;

        const redirectedToChat = await maybeOpenExistingChat();
        if (redirectedToChat) {
            return;
        }

        await resolveSelection();
        if (!hasValidSelection(state.selection)) {
            renderEmpty("메인 화면에서 아이템을 선택하고 매칭을 시작해주세요.");
            return;
        }

        await setUserStatus(state.uid, "matching");
        const redirectedAfterMatching = await maybeOpenExistingChat();
        if (redirectedAfterMatching) {
            return;
        }
        bindRequestButtons();
        listenMatches();
        listenIncomingRequests();
        bindVisibilityRecovery();
        startChatRecoveryPoll();
    } catch (error) {
        console.error("exchange init failed:", error);
        renderEmpty(`매칭 목록을 불러오지 못했습니다.\n${getInitErrorHint(error)}`);
    }
}

bindBackButton();
init();

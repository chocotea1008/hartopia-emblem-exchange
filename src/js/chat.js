import { items } from "../../js/data.js";
import { db } from "../../firebase-config.js";
import {
    addDoc,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ensureNotificationPermission } from "./permission.js";
import { initAnonymousAuth, setUserStatus } from "./auth.js";
import { buildChatId } from "./match.js";
import { getInitErrorHint } from "./error-hints.js";

const TRADE_COMPLETED_MESSAGE = "거래가 종료되었습니다. 나가셔도 좋습니다.";

const elements = {
    messageList: document.getElementById("message-list"),
    chatInput: document.getElementById("chat-input"),
    sendBtn: document.getElementById("send-btn"),
    partnerName: document.getElementById("partner-name-display"),
    giveContainer: document.querySelector("#chat-give-items .badge-row-chat"),
    getContainer: document.querySelector("#chat-get-items .badge-row-chat"),
    backBtn: document.getElementById("chat-back-btn"),
    exitModal: document.getElementById("exit-modal"),
    modalNo: document.getElementById("modal-no"),
    modalYes: document.getElementById("modal-yes"),
    completeBtn: document.getElementById("chat-complete-btn"),
    successModal: document.getElementById("success-modal"),
    successOk: document.getElementById("success-ok"),
};

const state = {
    uid: null,
    nickname: "",
    partnerId: null,
    chatId: null,
    chatRef: null,
    unsubscribeChat: null,
    unsubscribeMessages: null,
    completionModalShown: false,
};

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

function showSuccessModal() {
    if (!elements.successModal || state.completionModalShown) {
        return;
    }

    const modalTitle = elements.successModal.querySelector(".modal-title");
    if (modalTitle) {
        modalTitle.textContent = TRADE_COMPLETED_MESSAGE;
    }

    state.completionModalShown = true;
    elements.successModal.classList.add("active");
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

    const bubble = document.createElement("div");
    bubble.className = `msg-bubble ${
        isSystem ? "msg-partner" : isMe ? "msg-me" : "msg-partner"
    }`;

    if (isSystem) {
        bubble.style.alignSelf = "center";
        bubble.style.background = "rgba(255,255,255,0.85)";
        bubble.style.border = "2px dashed #d1d5db";
        bubble.style.color = "#374151";
        bubble.style.maxWidth = "92%";
        bubble.style.textAlign = "center";
    }

    const createdAt = message.createdAt?.toDate
        ? message.createdAt.toDate()
        : new Date();
    const time = createdAt.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
    });

    bubble.innerHTML = `
        <div class="msg-text">${message.text ?? ""}</div>
        <span class="msg-time">${time}</span>
    `;
    elements.messageList.appendChild(bubble);
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

function setChatInputEnabled(enabled) {
    if (elements.chatInput) {
        elements.chatInput.disabled = !enabled;
    }
    if (elements.sendBtn) {
        elements.sendBtn.disabled = !enabled;
        elements.sendBtn.style.opacity = enabled ? "1" : "0.5";
    }
    if (elements.completeBtn) {
        elements.completeBtn.disabled = !enabled;
        elements.completeBtn.style.opacity = enabled ? "1" : "0.6";
    }
}

async function sendMessage() {
    if (!state.chatRef || !elements.chatInput) {
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
    elements.chatInput.focus();
}

async function completeTrade() {
    if (!state.chatRef) {
        return;
    }

    await updateDoc(state.chatRef, {
        isCompleted: true,
        lastMessage: TRADE_COMPLETED_MESSAGE,
        lastSenderId: state.uid,
        updatedAt: serverTimestamp(),
    });

    await addDoc(collection(state.chatRef, "messages"), {
        senderId: state.uid,
        text: TRADE_COMPLETED_MESSAGE,
        type: "system",
        createdAt: serverTimestamp(),
    });
}

async function ensureChatExists() {
    if (!state.chatRef) {
        return;
    }

    await setDoc(
        state.chatRef,
        {
            participants: [state.uid, state.partnerId].filter(Boolean),
            participantNicknames: {
                [state.uid]: state.nickname,
            },
            isCompleted: false,
            updatedAt: serverTimestamp(),
        },
        { merge: true },
    );
}

function bindEvents() {
    if (elements.sendBtn) {
        elements.sendBtn.addEventListener("click", () => {
            sendMessage().catch(console.error);
        });
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
        elements.modalYes.addEventListener("click", async () => {
            await setUserStatus(state.uid, "matching");
            window.location.href = "exchange.html";
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

    if (elements.successOk) {
        elements.successOk.addEventListener("click", async () => {
            await setUserStatus(state.uid, "online");
            window.location.href = "index.html";
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
        if (!state.partnerId) {
            state.partnerId =
                (chatData.participants ?? []).find((uid) => uid !== state.uid) ?? null;
        }

        const partnerName = state.partnerId
            ? chatData.participantNicknames?.[state.partnerId] ?? "교환 파트너"
            : "교환 파트너";
        if (elements.partnerName) {
            elements.partnerName.textContent = partnerName;
        }

        const mySelection = chatData.selectionByUser?.[state.uid] ?? {
            giveItems: [],
            getItems: [],
        };
        renderItemStack(mySelection.giveItems, elements.giveContainer);
        renderItemStack(mySelection.getItems, elements.getContainer);

        if (chatData.isCompleted) {
            setChatInputEnabled(false);
            showSuccessModal();
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

async function init() {
    try {
        await ensureNotificationPermission();
        const { uid, nickname } = await initAnonymousAuth();
        state.uid = uid;
        state.nickname = nickname;

        resolveChatContext();
        if (!state.chatId) {
            alert("채팅 정보를 찾을 수 없습니다. 매칭 목록으로 이동합니다.");
            window.location.href = "exchange.html";
            return;
        }

        await setUserStatus(state.uid, "trading");
        state.chatRef = doc(db, "chats", state.chatId);

        bindEvents();
        await ensureChatExists();
        subscribeChat();
        subscribeMessages();
    } catch (error) {
        console.error("chat init failed:", error);
        alert(`채팅을 초기화하지 못했습니다.\n${getInitErrorHint(error)}`);
    }
}

init();

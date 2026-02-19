import { items as sourceItems } from "../../js/data.js";
import { ensureNotificationPermission } from "./permission.js";
import { initAnonymousAuth } from "./auth.js";
import { getInitErrorHint } from "./error-hints.js";
import {
    applySelectionToItems,
    hasValidSelection,
    loadSelectionFromStorage,
    saveSelection,
    saveSelectionToStorage,
    selectionFromItems,
    watchSelection,
} from "./db.js";
import {
    getPartnerIdFromChat,
    startMatchingSession,
    watchIncomingTradeRequests,
} from "./match.js";

const MATCHING_ACTIVE_STORAGE_KEY = "emblem.matching.active";

const elements = {
    mainToggle: document.getElementById("mode-switch"),
    toggleContainer: document.querySelector(".toggle-container"),
    resetBtn: document.getElementById("reset-mode-btn"),
    categoryContainer: document.getElementById("category-container"),
    completeBtn: document.getElementById("complete-btn"),
    actionArea: document.getElementById("action-area"),
    matchingArea: document.getElementById("matching-area"),
    matchingText: document.querySelector(".matching-text"),
    cancelBtn: document.getElementById("match-cancel-btn"),
    helpBtn: document.getElementById("help-btn"),
    helpModal: document.getElementById("help-modal"),
    helpClose: document.getElementById("help-close"),
};

const state = {
    uid: null,
    nickname: "",
    mode: "buy",
    items: sourceItems.map((item) => ({ ...item, status: "center" })),
    isMatching: false,
    isHybridMode: false,
    isRedirecting: false,
    matchingController: null,
    unsubscribeSelection: null,
    unsubscribeRequests: null,
};

function setMatchingActive(flag) {
    sessionStorage.setItem(MATCHING_ACTIVE_STORAGE_KEY, flag ? "1" : "0");
}

function isMatchingActive() {
    return sessionStorage.getItem(MATCHING_ACTIVE_STORAGE_KEY) === "1";
}

function showNotification(title, body, onClick) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
    }
    const notification = new Notification(title, { body });
    notification.onclick = () => {
        window.focus();
        if (typeof onClick === "function") {
            onClick();
        }
    };
}

function updateActionAreaUI() {
    if (!elements.actionArea || !elements.matchingArea) {
        return;
    }
    elements.actionArea.style.display = state.isMatching ? "none" : "flex";
    elements.matchingArea.style.display = state.isMatching ? "flex" : "none";
}

function updateModeUI() {
    if (!elements.toggleContainer) {
        return;
    }
    if (state.isHybridMode) {
        elements.toggleContainer.classList.add("is-toggle-mode");
    } else {
        elements.toggleContainer.classList.remove("is-toggle-mode");
    }
}

function getCategoryLabel(categoryKey) {
    const found = state.items.find((item) => item.category === categoryKey);
    if (found?.categoryLabel) {
        return found.categoryLabel;
    }
    if (categoryKey === "shiny") {
        return "빛나는";
    }
    if (categoryKey === "nebula") {
        return "네뷸라";
    }
    if (categoryKey === "rainbow") {
        return "무지개";
    }
    return categoryKey;
}

function checkCompleteStatus() {
    if (!elements.completeBtn) {
        return;
    }
    const selection = selectionFromItems(state.items);
    elements.completeBtn.disabled = !hasValidSelection(selection);
}

async function persistSelection() {
    if (!state.uid) {
        return;
    }
    const selection = selectionFromItems(state.items);
    saveSelectionToStorage(selection);
    await saveSelection(state.uid, selection);
}

function handleItemClick(item) {
    const targetStatus = state.isHybridMode
        ? "buy"
        : state.mode === "sell"
          ? "sell"
          : "buy";
    item.status = item.status === targetStatus ? "center" : targetStatus;
    render();
    persistSelection().catch(console.error);
}

function handleRightClick(item, event) {
    event.preventDefault();
    if (!state.isHybridMode) {
        state.isHybridMode = true;
        updateModeUI();
    }
    item.status = item.status === "sell" ? "center" : "sell";
    render();
    persistSelection().catch(console.error);
}

function render() {
    if (!elements.categoryContainer) {
        return;
    }
    elements.categoryContainer.innerHTML = "";

    const categoryOrder = ["shiny", "nebula", "rainbow"];

    for (const categoryKey of categoryOrder) {
        const categoryItems = state.items.filter((item) => item.category === categoryKey);
        const panel = document.createElement("div");
        panel.className = "category-panel";

        const header = document.createElement("div");
        header.className = "cat-header";

        const title = document.createElement("div");
        title.className = "cat-title-pill";
        title.textContent = getCategoryLabel(categoryKey);
        header.appendChild(title);

        const progressWrapper = document.createElement("div");
        progressWrapper.className = "cat-progress-wrapper";

        const buyCount = categoryItems.filter((item) => item.status === "buy").length;
        const sellCount = categoryItems.filter((item) => item.status === "sell").length;

        const buyPill = document.createElement("div");
        buyPill.className = `cat-progress pill-buy ${buyCount > 0 ? "active-buy" : ""}`;
        buyPill.textContent = `구매 ${buyCount}`;

        const sellPill = document.createElement("div");
        sellPill.className = `cat-progress pill-sell ${sellCount > 0 ? "active-sell" : ""}`;
        sellPill.textContent = `판매 ${sellCount}`;

        progressWrapper.appendChild(buyPill);
        progressWrapper.appendChild(sellPill);
        header.appendChild(progressWrapper);

        const grid = document.createElement("div");
        grid.className = "items-row";

        for (const item of categoryItems) {
            const card = document.createElement("div");
            const active = item.status !== "center";
            card.className = `pop-card ${active ? "active" : ""} status-${item.status}`;

            const image = document.createElement("img");
            image.src = item.src;
            image.alt = item.name ?? item.id;

            const num = document.createElement("div");
            num.className = "card-number";
            num.textContent = String(item.number ?? "");

            card.appendChild(image);
            card.appendChild(num);
            card.addEventListener("click", () => handleItemClick(item));
            card.addEventListener("contextmenu", (event) => handleRightClick(item, event));
            grid.appendChild(card);
        }

        panel.appendChild(header);
        panel.appendChild(grid);
        elements.categoryContainer.appendChild(panel);
    }

    checkCompleteStatus();
}

function stopMatchingUI() {
    state.isMatching = false;
    updateActionAreaUI();
}

async function cancelMatchingFlow() {
    if (state.matchingController) {
        await state.matchingController.cancel();
        state.matchingController = null;
    }
    setMatchingActive(false);
    stopMatchingUI();
}

function openExchangePage() {
    if (state.isRedirecting) {
        return;
    }
    setMatchingActive(false);
    state.isRedirecting = true;
    window.location.href = "exchange.html";
}

async function startMatchingFlow({ resume = false } = {}) {
    if (!state.uid || state.matchingController) {
        return;
    }

    const selection = selectionFromItems(state.items);
    if (!hasValidSelection(selection)) {
        return;
    }

    await saveSelection(state.uid, selection);
    saveSelectionToStorage(selection);

    state.isMatching = true;
    updateActionAreaUI();
    setMatchingActive(true);
    if (elements.matchingText) {
        elements.matchingText.textContent = "조건이 맞는 파트너를 탐색 중...";
    }

    try {
        state.matchingController = await startMatchingSession({
            uid: state.uid,
            giveItems: selection.giveItems,
            getItems: selection.getItems,
            resume,
            onUpdate: (matches) => {
                if (matches.length === 0) {
                    if (elements.matchingText) {
                        elements.matchingText.textContent = "조건이 맞는 파트너를 기다리는 중...";
                    }
                    return;
                }

                localStorage.setItem("emblem.matches", JSON.stringify(matches));
                showNotification(
                    "✨ 매칭 성공! 교환 파트너 발견!",
                    `${matches[0].nickname}님과 조건이 맞았습니다.`,
                    openExchangePage,
                );
                openExchangePage();
            },
            onExpired: async () => {
                state.matchingController = null;
                setMatchingActive(false);
                stopMatchingUI();
                alert("매칭 시간이 만료되었습니다.");
            },
        });
    } catch (error) {
        setMatchingActive(false);
        stopMatchingUI();
        throw error;
    }
}

function bindHelpModal() {
    if (elements.helpBtn && elements.helpModal) {
        elements.helpBtn.addEventListener("click", () => {
            elements.helpModal.classList.add("active");
        });
    }
    if (elements.helpClose && elements.helpModal) {
        elements.helpClose.addEventListener("click", () => {
            elements.helpModal.classList.remove("active");
        });
    }
}

function bindEvents() {
    if (elements.mainToggle) {
        elements.mainToggle.addEventListener("change", (event) => {
            state.mode = event.target.checked ? "sell" : "buy";
            render();
        });
    }

    if (elements.resetBtn) {
        elements.resetBtn.addEventListener("click", () => {
            state.isHybridMode = false;
            updateModeUI();
            render();
        });
    }

    if (elements.completeBtn) {
        elements.completeBtn.addEventListener("click", () => {
            if (!elements.completeBtn.disabled) {
                startMatchingFlow().catch(console.error);
            }
        });
    }

    if (elements.cancelBtn) {
        elements.cancelBtn.addEventListener("click", () => {
            cancelMatchingFlow().catch(console.error);
        });
    }

    bindHelpModal();
}

function maybeApplyStoredSelection() {
    const selection = loadSelectionFromStorage();
    state.items = applySelectionToItems(state.items, selection);
}

function listenSelection() {
    if (state.unsubscribeSelection) {
        state.unsubscribeSelection();
    }

    state.unsubscribeSelection = watchSelection(state.uid, (selection) => {
        const local = selectionFromItems(state.items);
        const remoteActivity = selection.activity ?? "idle";
        const sameGive =
            JSON.stringify([...local.giveItems].sort()) ===
            JSON.stringify([...(selection.giveItems ?? [])].sort());
        const sameGet =
            JSON.stringify([...local.getItems].sort()) ===
            JSON.stringify([...(selection.getItems ?? [])].sort());

        if (!sameGive || !sameGet) {
            state.items = applySelectionToItems(state.items, selection);
            saveSelectionToStorage({
                giveItems: selection.giveItems,
                getItems: selection.getItems,
            });
            render();
        }

        if (remoteActivity !== "matching" && state.isMatching) {
            if (state.matchingController) {
                state.matchingController.stop();
                state.matchingController = null;
            }
            setMatchingActive(false);
            stopMatchingUI();
        }
    });
}

function listenIncomingRequests() {
    if (state.unsubscribeRequests) {
        state.unsubscribeRequests();
    }

    state.unsubscribeRequests = watchIncomingTradeRequests(state.uid, (chatData) => {
        const partnerId = getPartnerIdFromChat(chatData, state.uid);
        const partnerName = partnerId
            ? chatData.participantNicknames?.[partnerId] ?? "상대방"
            : "상대방";

        showNotification(
            "교환 요청이 도착했습니다",
            `${partnerName}님이 교환 요청을 보냈습니다.`,
            () => {
                const nextUrl = `chat.html?chatId=${encodeURIComponent(chatData.chatId)}${
                    partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ""
                }`;
                window.location.href = nextUrl;
            },
        );
    });
}

async function init() {
    try {
        await ensureNotificationPermission();
        const { uid, nickname, activity } = await initAnonymousAuth();
        state.uid = uid;
        state.nickname = nickname;

        maybeApplyStoredSelection();
        bindEvents();
        render();
        updateActionAreaUI();
        listenSelection();
        listenIncomingRequests();
        await persistSelection();

        const hasSelection = hasValidSelection(selectionFromItems(state.items));
        if (!hasSelection) {
            setMatchingActive(false);
            return;
        }

        const shouldResumeMatching =
            activity === "matching" || isMatchingActive();
        if (shouldResumeMatching) {
            await startMatchingFlow({ resume: true });
        }
    } catch (error) {
        console.error("main init failed:", error);
        const hint = getInitErrorHint(error);
        alert(`초기화에 실패했습니다.\n${hint}`);
    }
}

init();

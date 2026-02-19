import {
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../../firebase-config.js";

const SELECTION_STORAGE_KEY = "emblem.selection";

function uniqueArray(items) {
    return [...new Set(Array.isArray(items) ? items : [])];
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

function deriveLegacyStatus(presence, activity) {
    if (activity === "matching" || activity === "trading") {
        return activity;
    }
    return "online";
}

export function selectionFromItems(items) {
    const giveItems = [];
    const getItems = [];

    for (const item of items) {
        if (item.status === "sell") {
            giveItems.push(item.id);
        } else if (item.status === "buy") {
            getItems.push(item.id);
        }
    }

    return {
        giveItems: uniqueArray(giveItems),
        getItems: uniqueArray(getItems),
    };
}

export function applySelectionToItems(items, selection) {
    const giveSet = new Set(selection?.giveItems ?? []);
    const getSet = new Set(selection?.getItems ?? []);

    return items.map((item) => {
        let status = "center";
        if (giveSet.has(item.id)) {
            status = "sell";
        } else if (getSet.has(item.id)) {
            status = "buy";
        }
        return { ...item, status };
    });
}

export function saveSelectionToStorage(selection) {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

export function loadSelectionFromStorage() {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) {
        return { giveItems: [], getItems: [] };
    }

    try {
        const parsed = JSON.parse(raw);
        return {
            giveItems: uniqueArray(parsed?.giveItems),
            getItems: uniqueArray(parsed?.getItems),
        };
    } catch {
        return { giveItems: [], getItems: [] };
    }
}

export async function saveSelection(uid, selection) {
    await setDoc(
        doc(db, "users", uid),
        {
            giveItems: uniqueArray(selection?.giveItems),
            getItems: uniqueArray(selection?.getItems),
            lastActive: serverTimestamp(),
        },
        { merge: true },
    );
}

export async function getSelection(uid) {
    const snapshot = await getDoc(doc(db, "users", uid));
    if (!snapshot.exists()) {
        return { giveItems: [], getItems: [] };
    }
    const data = snapshot.data();
    return {
        giveItems: uniqueArray(data.giveItems),
        getItems: uniqueArray(data.getItems),
    };
}

export function watchSelection(uid, onChange) {
    return onSnapshot(doc(db, "users", uid), (snapshot) => {
        if (!snapshot.exists()) {
            return;
        }

        const data = snapshot.data();
        const presence = derivePresence(data);
        const activity = deriveActivity(data);

        onChange({
            giveItems: uniqueArray(data.giveItems),
            getItems: uniqueArray(data.getItems),
            presence,
            activity,
            status: data.status ?? deriveLegacyStatus(presence, activity),
            matchingStartedAt: data.matchingStartedAt ?? null,
            nickname: data.nickname ?? "",
        });
    });
}

export function hasValidSelection(selection) {
    return (
        Array.isArray(selection?.giveItems) &&
        selection.giveItems.length > 0 &&
        Array.isArray(selection?.getItems) &&
        selection.getItems.length > 0
    );
}

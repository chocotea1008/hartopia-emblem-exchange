import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db } from "../../firebase-config.js";

const NICKNAME_STORAGE_KEY = "emblem.nickname";
const HEARTBEAT_MS = 60 * 1000;

const PRESENCE_ONLINE = "online";
const PRESENCE_OFFLINE = "offline";

const ACTIVITY_IDLE = "idle";
const ACTIVITY_MATCHING = "matching";
const ACTIVITY_TRADING = "trading";

const ADJECTIVES = [
    "즐거운",
    "배고픈",
    "반짝이는",
    "느긋한",
    "용감한",
    "신중한",
    "행복한",
    "기민한",
    "단단한",
    "유쾌한",
];

const NOUNS = [
    "네뷸라왕",
    "파칭코왕",
    "수집가",
    "교환러",
    "헌터",
    "파일럿",
    "탐험가",
    "장인",
    "큐레이터",
    "마스터",
];

let heartbeatTimer = null;
let lastUid = null;
let lastActivity = ACTIVITY_IDLE;
let detachPageHide = null;
let detachBeforeUnload = null;

function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildRandomNickname() {
    const adjective = ADJECTIVES[randomNumber(0, ADJECTIVES.length - 1)];
    const noun = NOUNS[randomNumber(0, NOUNS.length - 1)];
    const suffix = randomNumber(100, 999);
    return `${adjective} ${noun} ${suffix}`;
}

function activityFromLegacyStatus(status) {
    if (status === ACTIVITY_MATCHING) {
        return ACTIVITY_MATCHING;
    }
    if (status === ACTIVITY_TRADING) {
        return ACTIVITY_TRADING;
    }
    return ACTIVITY_IDLE;
}

function presenceFromLegacyStatus(status) {
    return status === PRESENCE_OFFLINE ? PRESENCE_OFFLINE : PRESENCE_ONLINE;
}

function normalizePresence(data) {
    if (data?.presence === PRESENCE_ONLINE || data?.presence === PRESENCE_OFFLINE) {
        return data.presence;
    }
    return presenceFromLegacyStatus(data?.status);
}

function normalizeActivity(data) {
    if (
        data?.activity === ACTIVITY_IDLE ||
        data?.activity === ACTIVITY_MATCHING ||
        data?.activity === ACTIVITY_TRADING
    ) {
        return data.activity;
    }
    return activityFromLegacyStatus(data?.status);
}

function toLegacyStatus(presence, activity) {
    if (activity === ACTIVITY_MATCHING || activity === ACTIVITY_TRADING) {
        return activity;
    }
    return PRESENCE_ONLINE;
}

function buildPresencePayload(presence, activity, extraFields = {}) {
    return {
        presence,
        activity,
        status: toLegacyStatus(presence, activity),
        lastActive: serverTimestamp(),
        ...extraFields,
    };
}

export function getOrCreateNickname() {
    const stored = localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (stored) {
        return stored;
    }

    const generated = buildRandomNickname();
    localStorage.setItem(NICKNAME_STORAGE_KEY, generated);
    return generated;
}

async function upsertUser(uid, nickname) {
    const userRef = doc(db, "users", uid);
    const snapshot = await getDoc(userRef);
    const existing = snapshot.exists() ? snapshot.data() : null;

    const activity = normalizeActivity(existing);
    const presence = PRESENCE_ONLINE;

    const payload = buildPresencePayload(presence, activity, { nickname });

    if (!snapshot.exists()) {
        payload.giveItems = [];
        payload.getItems = [];
    }

    await setDoc(userRef, payload, { merge: true });
    lastActivity = activity;

    return { presence, activity, status: payload.status };
}

function clearHeartbeat() {
    if (!heartbeatTimer) {
        return;
    }
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

function bindExitPresence(uid) {
    if (detachPageHide) {
        detachPageHide();
        detachPageHide = null;
    }
    if (detachBeforeUnload) {
        detachBeforeUnload();
        detachBeforeUnload = null;
    }

    const onPageHide = () => {
        updateDoc(doc(db, "users", uid), {
            presence: PRESENCE_OFFLINE,
            lastActive: serverTimestamp(),
        }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    detachPageHide = () => window.removeEventListener("pagehide", onPageHide);

    const onBeforeUnload = () => {
        updateDoc(doc(db, "users", uid), {
            presence: PRESENCE_OFFLINE,
            lastActive: serverTimestamp(),
        }).catch(() => {});
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    detachBeforeUnload = () =>
        window.removeEventListener("beforeunload", onBeforeUnload);
}

function startHeartbeat(uid) {
    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
        updateDoc(doc(db, "users", uid), {
            lastActive: serverTimestamp(),
        }).catch(() => {});
    }, HEARTBEAT_MS);
}

export async function setUserStatus(uid, status, extraFields = {}) {
    let presence = PRESENCE_ONLINE;
    let activity = ACTIVITY_IDLE;

    if (status === ACTIVITY_MATCHING) {
        presence = PRESENCE_ONLINE;
        activity = ACTIVITY_MATCHING;
        lastActivity = ACTIVITY_MATCHING;
    } else if (status === ACTIVITY_TRADING) {
        presence = PRESENCE_ONLINE;
        activity = ACTIVITY_TRADING;
        lastActivity = ACTIVITY_TRADING;
    } else if (status === PRESENCE_ONLINE) {
        presence = PRESENCE_ONLINE;
        activity = ACTIVITY_IDLE;
        lastActivity = ACTIVITY_IDLE;
    } else if (status === PRESENCE_OFFLINE) {
        presence = PRESENCE_OFFLINE;
        const current = await getDoc(doc(db, "users", uid));
        const currentData = current.exists() ? current.data() : null;
        activity = normalizeActivity(currentData) || lastActivity;
    } else {
        presence = PRESENCE_ONLINE;
        activity = status || ACTIVITY_IDLE;
        lastActivity = activity;
    }

    await setDoc(
        doc(db, "users", uid),
        buildPresencePayload(presence, activity, extraFields),
        { merge: true },
    );
}

export async function initAnonymousAuth() {
    const { user } = await signInAnonymously(auth);
    const nickname = getOrCreateNickname();

    const identity = await upsertUser(user.uid, nickname);
    startHeartbeat(user.uid);
    bindExitPresence(user.uid);
    lastUid = user.uid;

    return {
        uid: user.uid,
        nickname,
        presence: identity.presence,
        activity: identity.activity,
        status: identity.status,
    };
}

export async function stopPresence() {
    if (!lastUid) {
        return;
    }

    clearHeartbeat();
    await setUserStatus(lastUid, PRESENCE_OFFLINE);
    lastUid = null;

    if (detachPageHide) {
        detachPageHide();
        detachPageHide = null;
    }
    if (detachBeforeUnload) {
        detachBeforeUnload();
        detachBeforeUnload = null;
    }
}

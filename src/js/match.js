import {
    Timestamp,
    collection,
    deleteField,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../../firebase-config.js";

const MATCH_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_USER_THRESHOLD_MS = 3 * 60 * 1000;
const CHAT_OPENED_MESSAGE = "채팅방이 열렸습니다.";
const LEGACY_MATCH_REQUEST_MESSAGE = "교환 요청이 도착했습니다";

const PRESENCE_ONLINE = "online";
const PRESENCE_OFFLINE = "offline";
const ACTIVITY_IDLE = "idle";
const ACTIVITY_MATCHING = "matching";
const ACTIVITY_TRADING = "trading";

function unique(items) {
    return [...new Set(Array.isArray(items) ? items : [])];
}

function derivePresence(data) {
    if (data?.presence === PRESENCE_ONLINE || data?.presence === PRESENCE_OFFLINE) {
        return data.presence;
    }
    return data?.status === PRESENCE_OFFLINE ? PRESENCE_OFFLINE : PRESENCE_ONLINE;
}

function deriveActivity(data) {
    if (
        data?.activity === ACTIVITY_IDLE ||
        data?.activity === ACTIVITY_MATCHING ||
        data?.activity === ACTIVITY_TRADING
    ) {
        return data.activity;
    }
    if (data?.status === ACTIVITY_MATCHING || data?.status === ACTIVITY_TRADING) {
        return data.status;
    }
    return ACTIVITY_IDLE;
}

function deriveLegacyStatus(presence, activity) {
    if (activity === ACTIVITY_MATCHING || activity === ACTIVITY_TRADING) {
        return activity;
    }
    return PRESENCE_ONLINE;
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

function isChatOpenSignal(chatData) {
    if (chatData?.chatOpened === true) {
        return true;
    }
    if (typeof chatData?.lastMessage !== "string") {
        return false;
    }
    return (
        chatData.lastMessage.includes(CHAT_OPENED_MESSAGE) ||
        chatData.lastMessage.includes(LEGACY_MATCH_REQUEST_MESSAGE)
    );
}

function shouldNotifyIncomingChat(chatData, nowUpdatedAt, prevUpdatedAt, isInitial) {
    if (chatData?.isCompleted || chatData?.isCanceled) {
        return false;
    }
    if (!isChatOpenSignal(chatData)) {
        return false;
    }
    if (!isInitial && nowUpdatedAt <= prevUpdatedAt) {
        return false;
    }
    return true;
}

function intersect(left, right) {
    const rightSet = new Set(unique(right));
    return unique(left).filter((item) => rightSet.has(item));
}

function isExpired(matchingStartedAt) {
    const startedAtMs = toMillis(matchingStartedAt);
    if (!startedAtMs) {
        return true;
    }
    return Date.now() - startedAtMs > MATCH_TTL_MS;
}

function isRecentlyActive(lastActive) {
    const activeMs = toMillis(lastActive);
    if (!activeMs) {
        return false;
    }
    return Date.now() - activeMs <= ACTIVE_USER_THRESHOLD_MS;
}

function buildMatch(candidateDoc, myGiveItems, myGetItems) {
    const candidate = candidateDoc.data();
    const theirGive = unique(candidate.giveItems);
    const theirGet = unique(candidate.getItems);

    const getItems = intersect(theirGive, myGetItems);
    const giveItems = intersect(theirGet, myGiveItems);

    if (getItems.length === 0 || giveItems.length === 0) {
        return null;
    }

    return {
        uid: candidateDoc.id,
        nickname: candidate.nickname ?? `유저-${candidateDoc.id.slice(0, 5)}`,
        getItems,
        giveItems,
        score: getItems.length + giveItems.length,
        matchingStartedAt: candidate.matchingStartedAt ?? null,
        lastActive: candidate.lastActive ?? null,
    };
}

function sortMatches(matches) {
    return [...matches].sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return toMillis(a.matchingStartedAt) - toMillis(b.matchingStartedAt);
    });
}

function notifyMatchFound(match) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
    }
    const notification = new Notification("✨ 매칭 성공! 교환 파트너 발견!", {
        body: `${match.nickname}님과 ${match.score}개 조건이 일치합니다.`,
        tag: `match-${match.uid}`,
    });
    notification.onclick = () => window.focus();
}

function matchingWritePayload({ presence, activity, selection, withStartAt }) {
    const payload = {
        presence,
        activity,
        status: deriveLegacyStatus(presence, activity),
        giveItems: unique(selection?.giveItems),
        getItems: unique(selection?.getItems),
        lastActive: serverTimestamp(),
    };
    if (withStartAt) {
        payload.matchingStartedAt = Timestamp.now();
    }
    return payload;
}

export function buildChatId(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
}

export function getPartnerIdFromChat(chatData, myUid) {
    if (!Array.isArray(chatData?.participants)) {
        return null;
    }
    return chatData.participants.find((participantId) => participantId !== myUid) ?? null;
}

export async function cleanupExpiredMatchings() {
    const matchingSnapshot = await getDocs(
        query(collection(db, "users"), where("activity", "==", ACTIVITY_MATCHING)),
    );

    const staleDocs = matchingSnapshot.docs.filter((userDoc) =>
        isExpired(userDoc.data().matchingStartedAt),
    );

    await Promise.all(
        staleDocs.map((userDoc) => {
            const current = userDoc.data();
            const presence = derivePresence(current);
            return setDoc(
                doc(db, "users", userDoc.id),
                {
                    presence,
                    activity: ACTIVITY_IDLE,
                    status: deriveLegacyStatus(presence, ACTIVITY_IDLE),
                    matchingStartedAt: deleteField(),
                    giveItems: [],
                    getItems: [],
                    lastActive: serverTimestamp(),
                },
                { merge: true },
            );
        }),
    );

    return staleDocs.length;
}

export async function setMatchingState(uid, selection) {
    await setDoc(
        doc(db, "users", uid),
        matchingWritePayload({
            presence: PRESENCE_ONLINE,
            activity: ACTIVITY_MATCHING,
            selection,
            withStartAt: true,
        }),
        { merge: true },
    );
}

async function ensureMatchingState(uid, selection, resume) {
    if (!resume) {
        await setMatchingState(uid, selection);
        return;
    }

    const userRef = doc(db, "users", uid);
    const snapshot = await getDoc(userRef);
    const data = snapshot.exists() ? snapshot.data() : null;
    const currentActivity = deriveActivity(data);
    const shouldResetMatchingStart =
        !data?.matchingStartedAt ||
        currentActivity !== ACTIVITY_MATCHING ||
        isExpired(data.matchingStartedAt);

    const payload = matchingWritePayload({
        presence: PRESENCE_ONLINE,
        activity: ACTIVITY_MATCHING,
        selection,
        withStartAt: shouldResetMatchingStart,
    });

    await setDoc(userRef, payload, { merge: true });
}

export async function cancelMatching(uid) {
    await setDoc(
        doc(db, "users", uid),
        {
            presence: PRESENCE_ONLINE,
            activity: ACTIVITY_IDLE,
            status: deriveLegacyStatus(PRESENCE_ONLINE, ACTIVITY_IDLE),
            matchingStartedAt: deleteField(),
            lastActive: serverTimestamp(),
        },
        { merge: true },
    );
}

function computeMatches(snapshot, uid, myGiveItems, myGetItems) {
    const matches = [];

    for (const candidateDoc of snapshot.docs) {
        if (candidateDoc.id === uid) {
            continue;
        }

        const candidate = candidateDoc.data();
        const candidatePresence = derivePresence(candidate);
        const candidateActivity = deriveActivity(candidate);

        if (candidatePresence !== PRESENCE_ONLINE) {
            continue;
        }
        if (candidateActivity !== ACTIVITY_MATCHING) {
            continue;
        }
        if (isExpired(candidate.matchingStartedAt)) {
            continue;
        }
        if (!isRecentlyActive(candidate.lastActive)) {
            continue;
        }

        const match = buildMatch(candidateDoc, myGiveItems, myGetItems);
        if (match) {
            matches.push(match);
        }
    }

    return sortMatches(matches);
}

export async function startMatchingSession({
    uid,
    giveItems,
    getItems,
    resume = false,
    onUpdate,
    onExpired,
    onMatchFound,
}) {
    const myGiveItems = unique(giveItems);
    const myGetItems = unique(getItems);

    await ensureMatchingState(
        uid,
        { giveItems: myGiveItems, getItems: myGetItems },
        resume,
    );
    await cleanupExpiredMatchings();

    const seenMatches = new Set();
    const usersQuery = query(
        collection(db, "users"),
        where("activity", "==", ACTIVITY_MATCHING),
    );

    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
        const matches = computeMatches(snapshot, uid, myGiveItems, myGetItems);
        onUpdate?.(matches);

        const newMatch = matches.find((match) => !seenMatches.has(match.uid));
        if (newMatch) {
            notifyMatchFound(newMatch);
            onMatchFound?.(newMatch, matches);
        }
        for (const match of matches) {
            seenMatches.add(match.uid);
        }
    });

    const expiryTimer = setInterval(async () => {
        const myDoc = await getDoc(doc(db, "users", uid));
        if (!myDoc.exists()) {
            return;
        }

        const myData = myDoc.data();
        const myActivity = deriveActivity(myData);
        if (myActivity !== ACTIVITY_MATCHING) {
            return;
        }

        if (isExpired(myData.matchingStartedAt)) {
            await cancelMatching(uid);
            onExpired?.();
        }
    }, 30 * 1000);

    const stop = () => {
        unsubscribeUsers();
        clearInterval(expiryTimer);
    };

    const cancel = async () => {
        stop();
        await cancelMatching(uid);
    };

    return { stop, cancel };
}

export function watchPotentialMatches({ uid, giveItems, getItems, onUpdate }) {
    const usersQuery = query(
        collection(db, "users"),
        where("activity", "==", ACTIVITY_MATCHING),
    );
    const myGiveItems = unique(giveItems);
    const myGetItems = unique(getItems);

    return onSnapshot(usersQuery, (snapshot) => {
        const matches = computeMatches(snapshot, uid, myGiveItems, myGetItems);
        onUpdate?.(matches);
    });
}

export function watchIncomingTradeRequests(uid, onRequest, options = {}) {
    const emitInitial = options.emitInitial !== false;
    const chatsQuery = query(
        collection(db, "chats"),
        where("participants", "array-contains", uid),
    );

    const seenUpdateAt = new Map();
    let isBootstrapped = false;

    return onSnapshot(chatsQuery, (snapshot) => {
        if (!isBootstrapped) {
            const initialCandidates = [];
            for (const chatDoc of snapshot.docs) {
                const chatData = chatDoc.data();
                const nowUpdatedAt = toMillis(chatData.updatedAt);
                seenUpdateAt.set(chatDoc.id, nowUpdatedAt);

                if (
                    emitInitial &&
                    shouldNotifyIncomingChat(chatData, nowUpdatedAt, 0, true)
                ) {
                    initialCandidates.push({
                        chatId: chatDoc.id,
                        ...chatData,
                        __updatedAtMs: nowUpdatedAt,
                    });
                }
            }

            if (emitInitial && initialCandidates.length > 0) {
                initialCandidates.sort((a, b) => b.__updatedAtMs - a.__updatedAtMs);
                const latest = initialCandidates[0];
                delete latest.__updatedAtMs;
                onRequest?.(latest);
            }

            isBootstrapped = true;
            return;
        }

        for (const change of snapshot.docChanges()) {
            if (change.type === "removed") {
                seenUpdateAt.delete(change.doc.id);
                continue;
            }

            const chatData = change.doc.data();
            const nowUpdatedAt = toMillis(chatData.updatedAt);
            const prevUpdatedAt = seenUpdateAt.get(change.doc.id) ?? 0;
            seenUpdateAt.set(change.doc.id, nowUpdatedAt);

            if (
                !shouldNotifyIncomingChat(chatData, nowUpdatedAt, prevUpdatedAt, false)
            ) {
                continue;
            }

            onRequest?.({
                chatId: change.doc.id,
                ...chatData,
            });
        }
    });
}

export async function findLatestOpenChatForUser(uid) {
    const chatsSnapshot = await getDocs(
        query(collection(db, "chats"), where("participants", "array-contains", uid)),
    );

    let latest = null;
    let latestUpdatedAtMs = 0;

    for (const chatDoc of chatsSnapshot.docs) {
        const chatData = chatDoc.data();
        if (chatData?.isCompleted || chatData?.isCanceled) {
            continue;
        }
        if (!isChatOpenSignal(chatData)) {
            continue;
        }

        const updatedAtMs = toMillis(chatData.updatedAt);
        if (!latest || updatedAtMs >= latestUpdatedAtMs) {
            latest = {
                chatId: chatDoc.id,
                ...chatData,
            };
            latestUpdatedAtMs = updatedAtMs;
        }
    }

    return latest;
}

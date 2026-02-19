function includesAny(value, needles) {
    const lower = String(value ?? "").toLowerCase();
    return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

export function getInitErrorHint(error) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "");
    const combined = `${code} ${message}`;

    if (
        includesAny(combined, [
            "admin_only_operation",
            "operation-not-allowed",
            "auth/operation-not-allowed",
        ])
    ) {
        return "Firebase Authentication에서 익명 로그인(Anonymous)이 비활성화되어 있습니다. 콘솔에서 Anonymous를 활성화하세요.";
    }

    if (includesAny(combined, ["auth/unauthorized-domain", "unauthorized_domain"])) {
        return "현재 접속 도메인이 Firebase Authentication > Authorized domains에 등록되어 있지 않습니다.";
    }

    if (includesAny(combined, ["permission-denied", "missing or insufficient permissions"])) {
        return "Firestore 보안 규칙에서 현재 사용자 읽기/쓰기 권한이 차단되어 있습니다.";
    }

    if (includesAny(combined, ["network-request-failed"])) {
        return "네트워크 또는 방화벽 이슈로 Firebase 요청이 실패했습니다.";
    }

    if (includesAny(combined, ["notifications api", "notification"])) {
        return "브라우저 알림 권한 또는 알림 API 지원 상태를 확인해주세요.";
    }

    const printableCode = code || "unknown";
    const printableMessage = message || "원인 미상";
    return `에러 코드: ${printableCode} / 메시지: ${printableMessage}`;
}

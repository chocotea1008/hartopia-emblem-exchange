import { items } from './data.js';

const elements = {
    messageList: document.getElementById('message-list'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),
    partnerName: document.getElementById('partner-name-display'),
    giveContainer: document.querySelector('#chat-give-items .badge-row-chat'),
    getContainer: document.querySelector('#chat-get-items .badge-row-chat'),
    backBtn: document.getElementById('chat-back-btn'),
    exitModal: document.getElementById('exit-modal'),
    modalNo: document.getElementById('modal-no'),
    modalYes: document.getElementById('modal-yes'),
    completeBtnChat: document.getElementById('chat-complete-btn'),
    successModal: document.getElementById('success-modal'),
    successOk: document.getElementById('success-ok')
};

const partnerPhrases = [
    "안녕하세요! 휘장 교환 가능한가요?",
    "혹시 무지개 3번 상태 어떤가요?",
    "제가 지금 바로 거래 가능한데 어디서 뵐까요?",
    "네뷸라 휘장은 아껴둔거라 조심스럽네요 ㅎㅎ",
    "교칭 요청 수락했습니다!",
    "직거래 선호하시나요?",
    "휘장 케이스도 같이 주시나요?",
    "일단 만나서 상태 보고 결정해도 될까요?",
    "저 지금 가는 중입니다!",
    "잠시만요, 다른 분이랑도 연락 중이라.."
];

function init() {
    const chatData = JSON.parse(localStorage.getItem('chatPartner') || '{}');

    if (elements.partnerName) elements.partnerName.textContent = chatData.partnerName || '알 수 없음';

    // Render Dashboard Items
    renderDashboard(chatData.giveItems, elements.giveContainer);
    renderDashboard(chatData.getItems, elements.getContainer);

    setTimeout(() => {
        addMessage(chatData.partnerName || '상대방', "휘장 교환 제안 보고 연락 드렸습니다!", false);
    }, 800);

    // Chat events
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Back button with modal
    if (elements.backBtn) {
        elements.backBtn.addEventListener('click', () => {
            elements.exitModal.classList.add('active');
        });
    }

    if (elements.modalNo) {
        elements.modalNo.addEventListener('click', () => {
            elements.exitModal.classList.remove('active');
        });
    }

    if (elements.modalYes) {
        elements.modalYes.addEventListener('click', () => {
            location.href = 'exchange.html';
        });
    }

    if (elements.completeBtnChat) {
        elements.completeBtnChat.addEventListener('click', () => {
            if (elements.successModal) elements.successModal.classList.add('active');
        });
    }

    if (elements.successOk) {
        elements.successOk.addEventListener('click', () => {
            location.href = 'index.html';
        });
    }

    startBot();
}

function renderDashboard(itemIds, container) {
    if (!container || !itemIds) return;
    container.innerHTML = '';

    itemIds.forEach(id => {
        const item = items.find(i => i.id === id);
        if (item) {
            const wrapper = document.createElement('div');
            wrapper.className = 'mini-item-chat';

            const img = document.createElement('img');
            img.src = item.src;
            img.className = 'mini-badge-chat';

            const label = document.createElement('span');
            label.className = 'chat-item-label';
            label.textContent = `${item.categoryLabel} ${item.number}`;

            wrapper.appendChild(img);
            wrapper.appendChild(label);
            container.appendChild(wrapper);
        }
    });
}

function sendMessage() {
    const text = elements.chatInput.value.trim();
    if (!text) return;

    addMessage("나", text, true);
    elements.chatInput.value = '';
    elements.chatInput.focus();
}

function addMessage(sender, text, isMe) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg-bubble ${isMe ? 'msg-me' : 'msg-partner'}`;

    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    msgDiv.innerHTML = `
        <div class="msg-text">${text}</div>
        <span class="msg-time">${time}</span>
    `;

    elements.messageList.appendChild(msgDiv);
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function startBot() {
    setInterval(() => {
        const randomPhrase = partnerPhrases[Math.floor(Math.random() * partnerPhrases.length)];
        const chatData = JSON.parse(localStorage.getItem('chatPartner') || '{}');
        addMessage(chatData.partnerName || '상대방', randomPhrase, false);
    }, 5000);
}

init();

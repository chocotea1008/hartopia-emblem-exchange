import { items } from './data.js';
import { mockUsers } from './mock_users.js';

const setCookie = (name, value, days = 365) => {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}; expires=${expires}; path=/`;
};

const getCookie = (name) => {
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === name ? JSON.parse(decodeURIComponent(parts[1])) : r;
    }, null);
};

const initializedItems = items.map(item => {
    const saved = getCookie('userSelection');
    const matched = saved ? saved.find(s => s.id === item.id) : null;
    return {
        ...item,
        status: matched ? matched.status : (item.status || 'center')
    };
});

const state = {
    mode: 'buy',
    items: initializedItems,
    isMatching: false,
    isHybridMode: false
};

const elements = {
    toggleContainer: document.querySelector('.toggle-container'),
    mainToggle: document.getElementById('mode-switch'), // Checkbox ID
    categoryContainer: document.getElementById('category-container'),
    resetBtn: document.getElementById('reset-mode-btn'),
    completeBtn: document.getElementById('complete-btn'),
    actionArea: document.getElementById('action-area'),
    matchingArea: document.getElementById('matching-area'),
    matchingText: document.querySelector('.matching-text'),
    cancelBtn: document.getElementById('match-cancel-btn'),
    instructionText: document.getElementById('instruction-text')
};

function updateHeaderText() {
    if (state.mode === 'buy') {
        elements.instructionText.innerHTML = '당신이 <b>구하고자하는</b> 휘장을 선택하세요.';
    } else {
        elements.instructionText.innerHTML = '당신이 <b>중복 보유중인</b> 휘장을 선택하세요.';
    }
}

function init() {
    if (elements.mainToggle) {
        elements.mainToggle.addEventListener('change', (e) => {
            state.mode = e.target.checked ? 'sell' : 'buy';
            updateHeaderText();
            resetMatchingState();
            render();
        });
    }

    // Initial Text Set
    updateHeaderText();

    if (elements.completeBtn) {
        elements.completeBtn.addEventListener('click', () => {
            if (!elements.completeBtn.disabled) startMatchingProcess();
        });
    }

    if (elements.cancelBtn) {
        elements.cancelBtn.addEventListener('click', () => {
            resetMatchingState();
        });
    }

    // Help Modal Logic
    const helpBtn = document.getElementById('help-btn');
    const helpModal = document.getElementById('help-modal');
    const helpClose = document.getElementById('help-close');

    if (helpBtn && helpModal) {
        helpBtn.addEventListener('click', () => {
            helpModal.classList.add('active');
        });
    }

    if (helpClose && helpModal) {
        helpClose.addEventListener('click', () => {
            helpModal.classList.remove('active');
        });
    }

    if (elements.resetBtn) {
        elements.resetBtn.addEventListener('click', () => {
            state.isHybridMode = false;
            updateModeUI();
            resetMatchingState();
            setCookie('userSelection', state.items); // 쿠키 업데이트
            render();
        });
    }

    render();
}

function startMatchingProcess() {
    const buying = state.items.filter(i => i.status === 'buy').map(i => i.id);
    const selling = state.items.filter(i => i.status === 'sell').map(i => i.id);

    // Filter matched users: both must have cross-matches
    const matchedResults = mockUsers.filter(user => {
        const canGiveMe = user.selling.some(id => buying.includes(id));
        const canTakeMine = user.buying.some(id => selling.includes(id));
        return canGiveMe && canTakeMine;
    });

    if (matchedResults.length > 0) {
        // Success: Link to results
        const selectedItems = state.items.filter(i => i.status !== 'center');
        localStorage.setItem('userSelection', JSON.stringify(selectedItems));
        setCookie('userSelection', state.items); // 쿠키에도 영구 저장
        location.href = 'exchange.html';
    } else {
        // Queue Up: Wait for new users
        state.isMatching = true;
        updateActionAreaUI();
        if (elements.matchingText) {
            elements.matchingText.textContent = '조건에 맞는 파트너를 기다리는 중...';
        }
    }
}

function resetMatchingState() {
    state.isMatching = false;
    updateActionAreaUI();
}

function updateActionAreaUI() {
    if (!elements.actionArea || !elements.matchingArea) return;
    elements.actionArea.style.display = state.isMatching ? 'none' : 'flex';
    elements.matchingArea.style.display = state.isMatching ? 'flex' : 'none';
}

function updateModeUI() {
    if (elements.toggleContainer) {
        if (state.isHybridMode) elements.toggleContainer.classList.add('is-toggle-mode');
        else elements.toggleContainer.classList.remove('is-toggle-mode');
    }
}

function handleItemClick(item) {
    if (state.isHybridMode) {
        item.status = item.status === 'buy' ? 'center' : 'buy';
    } else {
        item.status = item.status === (state.mode === 'sell' ? 'sell' : 'buy') ? 'center' : (state.mode === 'sell' ? 'sell' : 'buy');
    }
    resetMatchingState();
    setCookie('userSelection', state.items); // 아이템 상태 쿠키에 저장
    render();
}

function handleRightClick(item, e) {
    e.preventDefault();
    if (!state.isHybridMode) {
        state.isHybridMode = true;
        updateModeUI();
    }
    item.status = item.status === 'sell' ? 'center' : 'sell';
    resetMatchingState();
    setCookie('userSelection', state.items); // 아이템 상태 쿠키에 저장
    render();
}

function render() {
    if (!elements.categoryContainer) return;
    elements.categoryContainer.innerHTML = '';

    const categoryOrder = [
        { key: 'shiny', label: '빛나는' },
        { key: 'nebula', label: '네뷸라' },
        { key: 'rainbow', label: '무지개' }
    ];

    categoryOrder.forEach(cat => {
        const catItems = state.items.filter(i => i.id.startsWith(cat.key));
        const panel = document.createElement('div');
        panel.className = 'category-panel';

        const header = document.createElement('div');
        header.className = 'cat-header';

        const title = document.createElement('div');
        title.className = 'cat-title-pill';
        title.textContent = cat.label;

        const progressWrapper = document.createElement('div');
        progressWrapper.className = 'cat-progress-wrapper';

        const buyCount = catItems.filter(i => i.status === 'buy').length;
        const buyPill = document.createElement('div');
        buyPill.className = `cat-progress pill-buy ${buyCount > 0 ? 'active-buy' : ''}`;
        buyPill.textContent = `구매 ${buyCount}`;

        const sellCount = catItems.filter(i => i.status === 'sell').length;
        const sellPill = document.createElement('div');
        sellPill.className = `cat-progress pill-sell ${sellCount > 0 ? 'active-sell' : ''}`;
        sellPill.textContent = `판매 ${sellCount}`;

        progressWrapper.appendChild(buyPill);
        progressWrapper.appendChild(sellPill);
        header.appendChild(title);
        header.appendChild(progressWrapper);

        const grid = document.createElement('div');
        grid.className = 'items-row';

        catItems.forEach(item => {
            const card = document.createElement('div');
            const isActive = item.status && item.status !== 'center';
            card.className = `pop-card ${isActive ? 'active' : ''} status-${item.status || 'center'}`;

            const img = document.createElement('img');
            img.src = item.src;
            card.appendChild(img);

            const num = document.createElement('div');
            num.className = 'card-number';
            num.textContent = item.number;
            card.appendChild(num);

            card.addEventListener('click', () => handleItemClick(item));
            card.addEventListener('contextmenu', (e) => handleRightClick(item, e));
            grid.appendChild(card);
        });

        panel.appendChild(header);
        panel.appendChild(grid);
        elements.categoryContainer.appendChild(panel);
    });

    checkCompleteStatus();
}

function checkCompleteStatus() {
    if (!elements.completeBtn) return;
    const buyCount = state.items.filter(i => i.status === 'buy').length;
    const sellCount = state.items.filter(i => i.status === 'sell').length;
    elements.completeBtn.disabled = !(buyCount >= 1 && sellCount >= 1);
}

init();

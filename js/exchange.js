import { mockUsers } from './mock_users.js';
import { items } from './data.js';

const elements = {
    exchangeList: document.getElementById('exchange-list')
};

function getCurrentUserSelection() {
    const saved = localStorage.getItem('userSelection');
    if (!saved) return { buying: [], selling: [] };

    const parsed = JSON.parse(saved);
    return {
        buying: parsed.filter(i => i.status === 'buy').map(i => i.id),
        selling: parsed.filter(i => i.status === 'sell').map(i => i.id)
    };
}

const mySelection = getCurrentUserSelection();

function init() {
    renderMatches();
}

function renderMatches() {
    if (!elements.exchangeList) return;
    elements.exchangeList.innerHTML = '';

    const mathcedResults = mockUsers.map(user => {
        const giveMe = user.selling.filter(id => mySelection.buying.includes(id));
        const giveThem = user.buying.filter(id => mySelection.selling.includes(id));

        if (giveMe.length > 0 && giveThem.length > 0) {
            return {
                ...user,
                matchMe: giveMe,
                matchThem: giveThem,
                totalScore: giveMe.length + giveThem.length
            };
        }
        return null;
    }).filter(res => res !== null);

    mathcedResults.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    if (mathcedResults.length === 0) {
        elements.exchangeList.innerHTML = `
            <div class="empty-match">
                <span>😢</span>
                <p>현재 매칭 가능한 유저가 없습니다.<br>다른 품목을 선택해보세요!</p>
            </div>
        `;
        return;
    }

    mathcedResults.forEach(match => {
        elements.exchangeList.appendChild(createExchangeCard(match));
    });

    // Event delegation for Request buttons
    elements.exchangeList.addEventListener('click', (e) => {
        const btn = e.target.closest('.request-btn');
        if (!btn) return;

        const card = btn.closest('.exchange-card');
        const userName = card.querySelector('.user-name').textContent.replace('✨ ', '');

        // Find which items were being exchanged in this specific match
        const match = mathcedResults.find(m => m.name === userName);

        const chatContext = {
            partnerName: userName,
            matchScore: match ? `${match.totalScore}개 겹침` : '0개',
            giveItems: match ? match.matchThem : [], // What I give (Them receive)
            getItems: match ? match.matchMe : []   // What I get (They give)
        };

        localStorage.setItem('chatPartner', JSON.stringify(chatContext));
        location.href = 'chat.html';
    });
}

function getItemInfo(id) {
    const item = items.find(i => i.id === id);
    if (!item) return { name: 'Unknown', num: '?' };

    let catName = '기타';
    if (id.includes('shiny')) catName = '빛나는';
    else if (id.includes('rainbow')) catName = '무지개';
    else if (id.includes('nebula')) catName = '네뷸라';

    return { name: catName, num: item.number, src: item.src };
}

function createExchangeCard(match) {
    const card = document.createElement('div');
    card.className = 'exchange-card';

    const timeAgo = getTimeAgo(match.timestamp);

    card.innerHTML = `
        <div class="card-top">
            <div class="user-meta">
                <span class="user-name">✨ ${match.name}</span>
                <span class="score-badge">${match.totalScore}개 겹침</span>
            </div>
            <span class="match-time">${timeAgo}</span>
        </div>
        <div class="card-body">
            <div class="exchange-diagram">
                <div class="item-group">
                    <span class="group-label label-give">보낼 휘장</span>
                    <div class="items-mini-grid">
                        ${match.matchThem.map(id => {
        const info = getItemInfo(id);
        return `
                                <div class="mini-item-box">
                                    <img src="${info.src}" class="mini-badge">
                                    <span class="item-label">${info.name} ${info.num}</span>
                                </div>`;
    }).join('')}
                    </div>
                </div>
                
                <div class="item-group">
                    <span class="group-label label-get">받을 휘장</span>
                    <div class="items-mini-grid">
                        ${match.matchMe.map(id => {
        const info = getItemInfo(id);
        return `
                                <div class="mini-item-box">
                                    <img src="${info.src}" class="mini-badge">
                                    <span class="item-label">${info.name} ${info.num}</span>
                                </div>`;
    }).join('')}
                    </div>
                </div>
            </div>
            
            <div class="action-side">
                <button class="request-btn">교환 요청</button>
            </div>
        </div>
    `;

    return card;
}

function getTimeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    return isoString.split('T')[0];
}

init();

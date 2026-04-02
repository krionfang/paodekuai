// ==================== 音频系统 ====================
const AudioSystem = {
    ctx: null,
    bgmGain: null,
    sfxGain: null,
    bgmPlaying: false,
    bgmSource: null,
    bgmBuffer: null,
    muted: false,

    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = 0.25;
        this.bgmGain.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.5;
        this.sfxGain.connect(this.ctx.destination);
    },

    // 合成一段轻松的背景音乐循环
    generateBGM() {
        const sr = this.ctx.sampleRate;
        const duration = 8; // 8秒循环
        const buf = this.ctx.createBuffer(2, sr * duration, sr);
        const L = buf.getChannelData(0);
        const R = buf.getChannelData(1);

        // 和弦进行: C - Am - F - G (经典)
        const chords = [
            [261.63, 329.63, 392.00], // C
            [220.00, 261.63, 329.63], // Am
            [174.61, 220.00, 261.63], // F
            [196.00, 246.94, 293.66], // G
        ];
        const beatsPerChord = sr * 2; // 每个和弦2秒

        for (let i = 0; i < L.length; i++) {
            const t = i / sr;
            const chordIdx = Math.floor(i / beatsPerChord) % 4;
            const chord = chords[chordIdx];
            let sample = 0;

            // 柔和的和弦铺底
            chord.forEach((freq, fi) => {
                sample += Math.sin(2 * Math.PI * freq * t) * 0.08 * (1 - fi * 0.15);
                sample += Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.04; // 低八度
            });

            // 简单的节奏感（轻柔的脉冲）
            const beat = (i % (sr / 2)) / (sr / 2);
            const pulse = Math.exp(-beat * 8) * 0.06;
            sample += pulse * Math.sin(2 * Math.PI * 80 * t);

            // 轻微的高音点缀
            const sixteenth = (i % (sr / 4)) / (sr / 4);
            if (sixteenth < 0.02) {
                const sparkle = Math.sin(2 * Math.PI * chord[0] * 2 * t) * 0.04;
                sample += sparkle;
            }

            // 淡入淡出处理
            const fadeIn = Math.min(1, t / 0.5);
            const fadeOut = Math.min(1, (duration - t) / 0.5);
            sample *= fadeIn * fadeOut;

            L[i] = sample;
            R[i] = sample * 0.95 + Math.sin(2 * Math.PI * chords[chordIdx][1] * t) * 0.02; // 轻微立体声
        }

        this.bgmBuffer = buf;
    },

    toggleBGM() {
        this.init();
        if (this.bgmPlaying) {
            this.stopBGM();
        } else {
            this.playBGM();
        }
        return this.bgmPlaying;
    },

    playBGM() {
        if (!this.ctx || this.bgmPlaying) return;
        if (!this.bgmBuffer) this.generateBGM();
        this.bgmSource = this.ctx.createBufferSource();
        this.bgmSource.buffer = this.bgmBuffer;
        this.bgmSource.loop = true;
        this.bgmSource.connect(this.bgmGain);
        this.bgmSource.start(0);
        this.bgmPlaying = true;
    },

    stopBGM() {
        if (this.bgmSource) {
            try { this.bgmSource.stop(); } catch(e) {}
            this.bgmSource = null;
        }
        this.bgmPlaying = false;
    },

    // 出牌音效
    playCard() {
        this._playTone(800, 0.08, 'square', 0.15);
        setTimeout(() => this._playTone(1200, 0.06, 'sine', 0.1), 50);
    },

    // 不出音效
    playPass() {
        this._playTone(300, 0.15, 'sine', 0.12);
    },

    // 炸弹音效
    playBomb() {
        this._playTone(150, 0.3, 'sawtooth', 0.25);
        setTimeout(() => this._playTone(100, 0.25, 'square', 0.2), 100);
        setTimeout(() => this._playTone(200, 0.2, 'sine', 0.15), 200);
    },

    // 胜利音效
    playWin() {
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            setTimeout(() => this._playTone(freq, 0.2, 'sine', 0.15), i * 150);
        });
    },

    // 失败音效
    playLose() {
        this._playTone(300, 0.3, 'sine', 0.15);
        setTimeout(() => this._playTone(250, 0.3, 'sine', 0.12), 200);
        setTimeout(() => this._playTone(200, 0.4, 'sine', 0.1), 400);
    },

    // 选牌音效
    playSelect() {
        this._playTone(600, 0.05, 'sine', 0.08);
    },

    // 你的回合提示音
    playTurn() {
        this._playTone(880, 0.1, 'sine', 0.12);
        setTimeout(() => this._playTone(1100, 0.1, 'sine', 0.1), 120);
    },

    // 发牌音效
    playDeal() {
        this._playTone(500, 0.04, 'triangle', 0.08);
    },

    _playTone(freq, duration, type = 'sine', volume = 0.1) {
        if (!this.ctx || this.muted) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(volume, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.sfxGain);
            osc.start(this.ctx.currentTime);
            osc.stop(this.ctx.currentTime + duration + 0.05);
        } catch(e) {}
    }
};

// ==================== 全局状态 ====================
const state = {
    playerName: '',
    roomCode: '',
    roomName: '',
    ws: null,
    initialChips: 100,
    myCards: [],
    selectedCards: [],
    currentTurn: '',
    players: [],
    isMyTurn: false,
    lastPlay: null,
    lastPlayType: null,
    lastPlayer: '',
    isNewRound: false,
    gameStarted: false,
    isAdmin: false,
    isSoloMode: false
};

// ==================== 牌面常量 ====================
const CARD_ORDER = {'3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11};
const CARD_TYPE_NAMES = {
    'single': '单张', 'pair': '对子', 'triple': '三条', 'triple_two': '三带二',
    'straight': '顺子', 'double_straight': '连对',
    'bomb_solo': '💣 炸弹', 'bomb_pure': '💣 炸弹',
    'four_three': '四带三', 'plane': '✈️ 飞机'
};

// ==================== 工具函数 ====================
function showToast(text, duration = 2500) {
    const toast = document.getElementById('toast');
    const toastText = document.getElementById('toast-text');
    toastText.textContent = text;
    toast.classList.remove('hidden');
    toast.querySelector('div').classList.add('toast-show');
    toast.querySelector('div').classList.remove('toast-hide');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.querySelector('div').classList.add('toast-hide');
        toast.querySelector('div').classList.remove('toast-show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, duration);
}

function switchPage(page) {
    ['lobby', 'room', 'game'].forEach(p => {
        document.getElementById(p + '-page').classList.add('hidden');
    });
    document.getElementById(page + '-page').classList.remove('hidden');
}

function getCardColor(suit) {
    return (suit === '♥' || suit === '♦') ? 'red' : 'black';
}

function parseCard(cardStr) {
    const suit = cardStr[0];
    const value = cardStr.substring(1);
    return { suit, value, color: getCardColor(suit) };
}

function sortCards(cards) {
    return [...cards].sort((a, b) => {
        const va = CARD_ORDER[a.substring(1)] || 0;
        const vb = CARD_ORDER[b.substring(1)] || 0;
        if (va !== vb) return va - vb;
        return a[0].localeCompare(b[0]);
    });
}

function createCardElement(cardStr, small = false) {
    const { suit, value, color } = parseCard(cardStr);
    const cls = small ? 'poker-card-sm' : 'poker-card';
    const div = document.createElement('div');
    div.className = `${cls} ${color}`;
    div.dataset.card = cardStr;
    if (small) {
        div.innerHTML = `<span class="card-suit">${suit}</span><span class="card-value">${value}</span>`;
    } else {
        div.innerHTML = `<span class="card-corner-top"><span class="corner-value">${value}</span><span class="corner-suit">${suit}</span></span><span class="card-suit">${suit}</span><span class="card-value">${value}</span><span class="card-suit-bottom">${suit}</span>`;
    }
    return div;
}

function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/${state.roomCode}/${encodeURIComponent(state.playerName)}`;
}

// 背景粒子效果
function initParticles() {
    const container = document.getElementById('bg-particles');
    if (!container) return;
    const suits = ['♠', '♥', '♣', '♦'];
    for (let i = 0; i < 12; i++) {
        const span = document.createElement('span');
        span.textContent = suits[i % 4];
        span.style.cssText = `
            position: absolute;
            font-size: ${12 + Math.random() * 16}px;
            color: rgba(255,255,255,${0.02 + Math.random() * 0.03});
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
            animation: float ${4 + Math.random() * 4}s ease-in-out infinite;
            animation-delay: ${Math.random() * 3}s;
        `;
        container.appendChild(span);
    }
}

// ==================== 大厅逻辑 ====================
function switchTab(tab) {
    const createTab = document.getElementById('tab-create');
    const joinTab = document.getElementById('tab-join');
    const soloTab = document.getElementById('tab-solo');
    const createPanel = document.getElementById('panel-create');
    const joinPanel = document.getElementById('panel-join');
    const soloPanel = document.getElementById('panel-solo');

    [createTab, joinTab, soloTab].forEach(t => {
        t.classList.remove('tab-active');
        t.classList.add('text-white/50');
    });
    [createPanel, joinPanel, soloPanel].forEach(p => p.classList.add('hidden'));

    if (tab === 'create') {
        createTab.classList.add('tab-active');
        createTab.classList.remove('text-white/50');
        createPanel.classList.remove('hidden');
    } else if (tab === 'join') {
        joinTab.classList.add('tab-active');
        joinTab.classList.remove('text-white/50');
        joinPanel.classList.remove('hidden');
    } else if (tab === 'solo') {
        soloTab.classList.add('tab-active');
        soloTab.classList.remove('text-white/50');
        soloPanel.classList.remove('hidden');
    }
}
window.switchTab = switchTab;

function selectChips(val) {
    state.initialChips = val;
    const btn100 = document.getElementById('chips-100');
    const btn200 = document.getElementById('chips-200');
    [btn100, btn200].forEach(b => b.classList.remove('chips-btn-active'));
    if (val === 100) {
        btn100.classList.add('chips-btn-active');
    } else {
        btn200.classList.add('chips-btn-active');
    }
}
window.selectChips = selectChips;

async function createRoom() {
    const name = document.getElementById('create-name').value.trim();
    const roomName = document.getElementById('create-room-name').value.trim();
    if (!name) { showToast('请输入昵称'); return; }
    if (!roomName) { showToast('请输入房间名称'); return; }

    try {
        const res = await fetch('/api/create_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_name: roomName, host_name: name, initial_chips: state.initialChips })
        });
        const data = await res.json();
        if (data.code === 0) {
            state.playerName = name;
            state.roomCode = data.data.room_code;
            state.roomName = roomName;
            enterRoom();
        } else {
            showToast(data.detail || '创建失败');
        }
    } catch (e) {
        showToast('网络错误，请重试');
    }
}

async function joinRoom() {
    const name = document.getElementById('join-name').value.trim();
    const code = document.getElementById('join-code').value.trim();
    if (!name) { showToast('请输入昵称'); return; }
    if (!code || code.length !== 6) { showToast('请输入6位房间号'); return; }

    try {
        const res = await fetch('/api/join_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_code: code, player_name: name })
        });
        const data = await res.json();
        if (res.ok && data.code === 0) {
            state.playerName = name;
            state.roomCode = code;
            state.roomName = data.data.room_name;
            enterRoom();
        } else {
            showToast(data.detail || '加入失败');
        }
    } catch (e) {
        showToast('网络错误，请重试');
    }
}

async function startSolo() {
    const name = document.getElementById('solo-name').value.trim();
    if (!name) { showToast('请输入昵称'); return; }

    try {
        const res = await fetch('/api/start_solo', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        if (data.code === 0) {
            state.playerName = name;
            state.roomCode = data.data.room_code;
            state.roomName = data.data.room_name;
            state.isSoloMode = true;
            showToast('正在进入试玩模式...');
            enterRoom();
        } else {
            showToast(data.detail || '启动失败');
        }
    } catch (e) {
        showToast('网络错误，请重试');
    }
}

// ==================== 房间逻辑 ====================
function enterRoom() {
    switchPage('room');
    document.getElementById('room-title').textContent = state.roomName;
    document.getElementById('room-code-display').textContent = '房间号: ' + state.roomCode;
    connectWebSocket();
}

function connectWebSocket() {
    if (state.ws) {
        state.ws.close();
    }
    state.ws = new WebSocket(getWsUrl());

    state.ws.onopen = () => {
        addChatMessage('system', '已连接到房间');
    };
    state.ws.onclose = () => {
        addChatMessage('system', '连接已断开');
    };
    state.ws.onerror = () => {
        showToast('连接出错');
    };
    state.ws.onmessage = (event) => {
        handleMessage(JSON.parse(event.data));
    };
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'room_state': updateRoomState(msg.data); break;
        case 'game_start': startGame(msg.data); break;
        case 'play': handlePlay(msg.data); break;
        case 'player_pass': handlePass(msg.data); break;
        case 'game_end': handleGameEnd(msg.data); break;
        case 'chat': addChatMessage(msg.data.player, msg.data.msg); break;
        case 'error': showToast(msg.msg); break;
        case 'admin_login_result': handleAdminLoginResult(msg); break;
        case 'kicked': handleKicked(msg); break;
    }
}

function updateRoomState(data) {
    state.players = data.players;
    // 检查自己是否是管理员
    if (data.admins && data.admins.includes(state.playerName)) {
        state.isAdmin = true;
    }
    updateAdminUI();

    // 更新座位
    for (let i = 0; i < 3; i++) {
        const seatEl = document.getElementById(`seat-${i}`);
        const player = data.players.find(p => p.seat === i);
        if (player) {
            const isMe = player.name === state.playerName;
            const readyCls = player.ready ? 'ready' : '';
            const adminBadge = player.is_admin ? '<span class="admin-badge mt-1">🛡️ 管理员</span>' : '';
            seatEl.className = `seat-card occupied ${readyCls}`;
            seatEl.innerHTML = `
                <div class="w-20 h-20 mx-auto mb-3 ${isMe ? 'bg-gradient-to-br from-amber-400/20 to-amber-600/20 border-amber-400/50' : 'bg-white/[0.08] border-white/10'} rounded-full flex items-center justify-center text-4xl border-2 transition-all relative">
                    ${player.is_host ? '👑' : '🎮'}
                    ${player.is_admin ? '<div class="admin-indicator">🛡</div>' : ''}
                </div>
                <div class="text-white font-bold text-sm">${player.name}${isMe ? ' <span class="text-amber-400 text-xs">(我)</span>' : ''}</div>
                <div class="text-amber-400/80 text-xs mt-1.5 font-mono">💰 ${player.chips}</div>
                ${adminBadge}
                ${player.ready ? '<div class="mt-2 text-xs text-emerald-400 font-bold">✅ 已准备</div>' : ''}
            `;
        } else {
            seatEl.className = 'seat-card';
            seatEl.innerHTML = `
                <div class="w-20 h-20 mx-auto mb-3 bg-white/[0.04] rounded-full flex items-center justify-center text-4xl border-2 border-dashed border-white/10">👤</div>
                <div class="text-white/25 text-sm">等待加入...</div>
            `;
        }
    }

    // 更新准备按钮
    const myPlayer = data.players.find(p => p.name === state.playerName);
    const readyBtn = document.getElementById('btn-ready');
    if (myPlayer && myPlayer.ready) {
        readyBtn.textContent = '❌ 取消准备';
        readyBtn.className = 'game-btn-pass px-16 text-base';
    } else {
        readyBtn.textContent = '✋ 准备';
        readyBtn.className = 'game-btn-primary px-16';
    }

    // 更新管理员面板中的玩家列表
    updateAdminPanel();
}

// ==================== 游戏逻辑 ====================
function startGame(data) {
    state.gameStarted = true;
    state.myCards = data.your_cards;
    state.currentTurn = data.current_turn;
    state.selectedCards = [];
    state.lastPlay = null;
    state.lastPlayType = null;
    state.lastPlayer = '';
    state.isNewRound = true;
    state.players = data.players;

    switchPage('game');
    document.getElementById('game-room-name').textContent = state.roomName;
    document.getElementById('my-name-display').textContent = state.playerName;

    updateGamePlayers(data.players);
    renderMyHand(true);
    updateTurnState();
    clearPlayAreas();
    addChatMessage('system', '🎮 游戏开始！祝你好运！');
}

function updateGamePlayers(players) {
    const myIdx = players.findIndex(p => p.name === state.playerName);
    const leftIdx = (myIdx + 1) % 3;
    const rightIdx = (myIdx + 2) % 3;
    const left = players[leftIdx];
    const right = players[rightIdx];

    document.getElementById('opp-left-name').textContent = left.name;
    document.getElementById('opp-left-chips').textContent = left.chips;
    document.getElementById('opp-left-cards').textContent = left.cards_count;

    document.getElementById('opp-right-name').textContent = right.name;
    document.getElementById('opp-right-chips').textContent = right.chips;
    document.getElementById('opp-right-cards').textContent = right.cards_count;

    const me = players[myIdx];
    document.getElementById('my-chips').textContent = me.chips;
}

function renderMyHand(withAnimation = false) {
    const hand = document.getElementById('my-hand');
    hand.innerHTML = '';
    const sorted = sortCards(state.myCards);
    state.myCards = sorted;

    sorted.forEach((cardStr, idx) => {
        const el = createCardElement(cardStr);
        if (state.selectedCards.includes(cardStr)) {
            el.classList.add('selected');
        }
        if (withAnimation) {
            el.classList.add('card-deal-anim');
            el.style.animationDelay = `${idx * 0.04}s`;
            setTimeout(() => AudioSystem.playDeal(), idx * 40);
        }
        el.addEventListener('click', () => toggleCardSelection(cardStr, el));
        hand.appendChild(el);
    });

    document.getElementById('my-cards-count').textContent = state.myCards.length;
}

function toggleCardSelection(cardStr, el) {
    if (!state.isMyTurn) {
        showToast('还没轮到你出牌哦');
        return;
    }
    const idx = state.selectedCards.indexOf(cardStr);
    if (idx >= 0) {
        state.selectedCards.splice(idx, 1);
        el.classList.remove('selected');
    } else {
        state.selectedCards.push(cardStr);
        el.classList.add('selected');
        AudioSystem.playSelect();
    }
}

function updateTurnState() {
    state.isMyTurn = state.currentTurn === state.playerName;
    const statusText = document.getElementById('game-status-text');
    const btnPass = document.getElementById('btn-pass');
    const btnPlay = document.getElementById('btn-play');
    const btnHint = document.getElementById('btn-hint');

    if (state.isMyTurn) {
        AudioSystem.playTurn();
        statusText.textContent = '🎯 轮到你出牌!';
        statusText.className = 'text-amber-400 text-sm font-bold px-4 py-1 bg-amber-400/15 rounded-full border border-amber-400/30 animate-pulse';
        btnPlay.classList.remove('hidden');
        btnHint.classList.remove('hidden');
        if (state.isNewRound || state.lastPlayer === state.playerName || !state.lastPlay) {
            btnPass.classList.add('hidden');
        } else {
            btnPass.classList.remove('hidden');
        }
    } else {
        statusText.textContent = `⏳ 等待 ${state.currentTurn} 出牌...`;
        statusText.className = 'text-emerald-300/80 text-sm font-medium px-4 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20';
        btnPass.classList.add('hidden');
        btnPlay.classList.add('hidden');
        btnHint.classList.add('hidden');
    }
    updateTurnHighlight();
}

function updateTurnHighlight() {
    const players = state.players;
    if (!players || players.length === 0) return;
    const myIdx = players.findIndex(p => p.name === state.playerName);
    const leftIdx = (myIdx + 1) % 3;
    const rightIdx = (myIdx + 2) % 3;

    const leftAvatar = document.getElementById('opp-left-avatar');
    const rightAvatar = document.getElementById('opp-right-avatar');
    const myAvatar = document.getElementById('my-avatar');

    [leftAvatar, rightAvatar, myAvatar].forEach(a => a.classList.remove('active-turn'));

    if (state.currentTurn === players[leftIdx].name) {
        leftAvatar.classList.add('active-turn');
    } else if (state.currentTurn === players[rightIdx].name) {
        rightAvatar.classList.add('active-turn');
    } else if (state.currentTurn === state.playerName) {
        myAvatar.classList.add('active-turn');
    }
}

function clearPlayAreas() {
    document.getElementById('opp-left-play').innerHTML = '';
    document.getElementById('opp-right-play').innerHTML = '';
    document.getElementById('my-play-area').innerHTML = '';
    const badge = document.getElementById('center-badge');
    const cardsContainer = document.getElementById('center-cards');
    const passInfo = document.getElementById('center-pass-info');
    badge.classList.add('hidden');
    cardsContainer.innerHTML = '<div class="text-white/20 text-sm italic px-4 py-2">等待出牌...</div>';
    passInfo.classList.add('hidden');
    passInfo.innerHTML = '';
    document.getElementById('last-play-info').textContent = '';
}

function handlePlay(data) {
    state.currentTurn = data.current_turn;
    state.lastPlay = data.cards;
    state.lastPlayType = data.card_type;
    state.lastPlayer = data.player;
    state.isNewRound = false;
    state.selectedCards = [];

    if (data.your_cards) {
        state.myCards = data.your_cards;
    }

    const players = state.players;
    const myIdx = players.findIndex(p => p.name === state.playerName);
    const leftIdx = (myIdx + 1) % 3;
    const rightIdx = (myIdx + 2) % 3;

    // 清空个人出牌区
    document.getElementById('opp-left-play').innerHTML = '';
    document.getElementById('opp-right-play').innerHTML = '';
    document.getElementById('my-play-area').innerHTML = '';

    // 更新牌数显示
    if (data.player === players[leftIdx].name) {
        players[leftIdx].cards_count = data.cards_left;
        document.getElementById('opp-left-cards').textContent = data.cards_left;
    } else if (data.player === players[rightIdx].name) {
        players[rightIdx].cards_count = data.cards_left;
        document.getElementById('opp-right-cards').textContent = data.cards_left;
    }

    // 中间区域统一显示出牌
    showCenterCards(data.cards, data.player, data.card_type);

    // 清除"不出"标记
    document.getElementById('center-pass-info').classList.add('hidden');
    document.getElementById('center-pass-info').innerHTML = '';

    // 顶部信息栏
    const typeName = CARD_TYPE_NAMES[data.card_type] || data.card_type;
    const isBomb = data.card_type === 'bomb_solo' || data.card_type === 'bomb_pure';
    document.getElementById('last-play-info').innerHTML = `
        <span class="text-white/50">${data.player}</span>
        <span class="card-type-tag ${isBomb ? 'bomb' : 'normal'} ml-1">${typeName}</span>
    `;

    renderMyHand();
    updateTurnState();

    // 音效
    if (isBomb) {
        AudioSystem.playBomb();
        showToast('💣 炸弹！！！', 1500);
    } else {
        AudioSystem.playCard();
    }
}

function showPlayedCards(containerId, cards) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const sorted = sortCards(cards);
    sorted.forEach((cardStr, idx) => {
        const el = createCardElement(cardStr, true);
        el.classList.add('card-played');
        el.style.animationDelay = `${idx * 0.05}s`;
        container.appendChild(el);
    });
}

function showCenterCards(cards, playerName, cardType) {
    const badge = document.getElementById('center-badge');
    const cardsContainer = document.getElementById('center-cards');

    // 显示玩家标识
    const isMe = playerName === state.playerName;
    badge.textContent = `${playerName} 出的牌`;
    badge.className = `play-player-badge mb-3 ${isMe ? 'mine' : 'opponent'}`;
    badge.classList.remove('hidden');

    // 显示牌
    cardsContainer.innerHTML = '';
    const sorted = sortCards(cards);
    sorted.forEach((cardStr, idx) => {
        const el = createCardElement(cardStr, true);
        el.classList.add('card-played');
        el.style.animationDelay = `${idx * 0.05}s`;
        cardsContainer.appendChild(el);
    });
}

function showCenterPass(playerName) {
    const cardsContainer = document.getElementById('center-cards');
    const passInfo = document.getElementById('center-pass-info');

    // 保留上一张牌，在下方添加"xxx 不出（要压 yyy 的牌）"
    const isMe = playerName === state.playerName;
    const playerClass = isMe ? 'bg-amber-500/20 border-amber-500/30' : 'bg-rose-500/20 border-rose-500/30';

    const lastPlayer = state.lastPlayer || '';
    let passText = `${playerName}：不出`;
    if (lastPlayer && lastPlayer !== playerName) {
        passText += `（要压 ${lastPlayer} 的牌）`;
    }

    passInfo.innerHTML = `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full ${playerClass} border">${passText}</span>`;
    passInfo.classList.remove('hidden');
}

function handlePass(data) {
    state.currentTurn = data.current_turn;
    AudioSystem.playPass();
    if (data.your_cards) {
        state.myCards = data.your_cards;
    }

    const players = state.players;
    const myIdx = players.findIndex(p => p.name === state.playerName);
    const leftIdx = (myIdx + 1) % 3;
    const rightIdx = (myIdx + 2) % 3;

    if (data.new_round) {
        state.isNewRound = true;
        state.lastPlay = null;
        state.lastPlayType = null;
        state.lastPlayer = '';
        addChatMessage('system', `${data.player} 不出 — 🔄 新一轮开始`);
        clearPlayAreas();
    } else {
        state.isNewRound = false;
        addChatMessage('system', `${data.player} 不出`);
        // 清空个人出牌区
        document.getElementById('opp-left-play').innerHTML = '';
        document.getElementById('opp-right-play').innerHTML = '';
        document.getElementById('my-play-area').innerHTML = '';
        // 显示"不出"标记（保留上一张牌）
        showCenterPass(data.player);
    }

    state.selectedCards = [];
    renderMyHand();
    updateTurnState();
}

function handleGameEnd(data) {
    state.gameStarted = false;
    const modal = document.getElementById('result-modal');
    const content = document.getElementById('result-content');
    const body = document.getElementById('result-body');

    const isWinner = data.winner === state.playerName;
    if (isWinner) {
        AudioSystem.playWin();
    } else {
        AudioSystem.playLose();
    }
    let html = '';

    // 头部标题
    html += `<div class="text-center mb-4">
        <div class="text-6xl mb-2">${isWinner ? '🏆' : '😔'}</div>
        <h3 class="text-2xl font-bold ${isWinner ? 'text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-200' : 'text-gray-400'}">
            ${isWinner ? '恭喜你赢了！' : '很遗憾，你输了'}
        </h3>
        ${isWinner ? '<p class="text-amber-400/60 text-sm mt-1">技术精湛，无人能敌</p>' : `<p class="text-amber-400 mt-2 font-medium">${data.winner} 获胜！</p>`}
    </div>`;

    // 特殊标记：炸弹、春天
    if (data.bomb_count > 0 || data.is_spring) {
        html += `<div class="flex justify-center gap-2 mb-3">`;
        if (data.bomb_count > 0) {
            html += `<span class="text-xs bg-red-500/20 text-red-300 px-3 py-1 rounded-full border border-red-500/30">💣 炸弹 x${data.bomb_count}（每人加罚 ${data.bomb_count * 10}）</span>`;
        }
        if (data.is_spring) {
            html += `<span class="text-xs bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full border border-purple-500/30">🌸 春天！全部翻倍</span>`;
        }
        html += `</div>`;
    }

    // 累计数据
    html += `<div class="bg-white/[0.06] rounded-2xl p-4 mb-4 text-center">
        <div class="text-white/60 text-xs mb-2">我的战绩</div>
        <div class="flex justify-center gap-8">
            <div>
                <div class="text-2xl font-black text-white">${data.your_games_played || 0}</div>
                <div class="text-white/50 text-xs">总局数</div>
            </div>
            <div>
                <div class="text-2xl font-black text-amber-400">${data.your_games_won || 0}</div>
                <div class="text-white/50 text-xs">获胜</div>
            </div>
            <div>
                <div class="text-2xl font-black text-white">${data.your_chips || 0}</div>
                <div class="text-white/50 text-xs">当前筹码</div>
            </div>
        </div>
    </div>`;

    html += '<div class="space-y-3">';
    html += `<div class="flex items-center justify-between px-4 py-3 rounded-2xl ${isWinner ? 'bg-gradient-to-r from-amber-500/15 to-yellow-500/15 border border-amber-500/20' : 'bg-white/[0.04]'}">
        <div class="flex items-center gap-2">
            <span class="text-xl">🏆</span>
            <span class="text-white font-bold">${data.winner}</span>
        </div>
        <div class="text-right">
            <span class="text-amber-400 font-black text-lg">+${data.total_won} 💰</span>
            <div class="text-white/40 text-xs">共 ${data.winner_chips} 💰</div>
        </div>
    </div>`;

    data.losers.forEach(loser => {
        const isLoserMe = loser.name === state.playerName;
        let tags = '';
        if (loser.is_spring) tags += '<span class="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full ml-1">春天</span>';
        html += `<div class="flex items-center justify-between px-4 py-3 rounded-2xl ${isLoserMe ? 'bg-red-500/10 border border-red-500/15' : 'bg-white/[0.04]'}">
            <div class="flex items-center gap-2">
                <span class="text-white/80">${loser.name}</span>${tags}
            </div>
            <div class="text-right text-xs">
                <div class="text-red-400 font-bold">剩${loser.cards_left}张 · -${loser.chips_lost}💰</div>
                <div class="text-white/40 mt-0.5">余 ${loser.chips_remaining} 💰</div>
            </div>
        </div>`;
    });
    html += '</div>';

    body.innerHTML = html;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => content.classList.add('result-show'), 50);
}

function addChatMessage(sender, text) {
    const containers = [
        document.getElementById('chat-messages-room'),
        document.getElementById('chat-messages-game')
    ];
    containers.forEach(container => {
        if (!container) return;
        const div = document.createElement('div');
        if (sender === 'system') {
            div.className = 'chat-msg-system';
            div.textContent = `[系统] ${text}`;
        } else {
            div.className = 'chat-msg';
            div.innerHTML = `<span class="chat-name">${sender}:</span> ${text}`;
        }
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    });
}

// ==================== 出牌操作 ====================
function playCards() {
    if (state.selectedCards.length === 0) {
        showToast('请先选择要出的牌');
        return;
    }
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'play', cards: state.selectedCards }));
    }
}

function passPlay() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'pass' }));
    }
}

function toggleReady() {
    const myPlayer = state.players.find(p => p.name === state.playerName);
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        if (myPlayer && myPlayer.ready) {
            state.ws.send(JSON.stringify({ action: 'cancel_ready' }));
        } else {
            state.ws.send(JSON.stringify({ action: 'ready' }));
        }
    }
}

function sendChat(page) {
    const inputId = page === 'room' ? 'chat-input-room' : 'chat-input-game';
    const input = document.getElementById(inputId);
    const text = input.value.trim();
    if (!text) return;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'chat', msg: text }));
    }
    input.value = '';
}

function leaveRoom() {
    if (state.ws) { state.ws.close(); state.ws = null; }
    state.gameStarted = false;
    state.isAdmin = false;
    switchPage('lobby');
    hideAdminPanel();
}

// ==================== 管理员功能 ====================
function showAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('admin-password-input').value = '';
    document.getElementById('admin-password-input').focus();
}

function hideAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function submitAdminLogin() {
    const pwd = document.getElementById('admin-password-input').value.trim();
    if (!pwd) {
        showToast('请输入密码');
        return;
    }
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'admin_login', password: pwd }));
    }
}

function handleAdminLoginResult(msg) {
    if (msg.success) {
        state.isAdmin = true;
        hideAdminLoginModal();
        showToast('🛡️ 管理员验证成功！');
        updateAdminUI();
        showAdminPanel();
    } else {
        showToast('❌ ' + msg.msg);
    }
}

function handleKicked(msg) {
    showToast('🚫 ' + msg.msg, 4000);
    if (state.ws) { state.ws.close(); state.ws = null; }
    state.gameStarted = false;
    state.isAdmin = false;
    switchPage('lobby');
    hideAdminPanel();
}

function updateAdminUI() {
    const entryBtn = document.getElementById('admin-entry-btn');
    const loginBtn = document.getElementById('btn-admin-login-room');
    
    if (state.isAdmin) {
        // 显示浮动管理员按钮
        entryBtn.classList.remove('hidden');
        // 更改登录入口文字
        if (loginBtn) {
            loginBtn.innerHTML = '🛡️ <span class="text-red-400">管理员面板</span>';
        }
    } else {
        entryBtn.classList.add('hidden');
    }
}

function showAdminPanel() {
    if (!state.isAdmin) return;
    const panel = document.getElementById('admin-panel-room');
    panel.classList.remove('hidden');
    updateAdminPanel();
}

function hideAdminPanel() {
    const panel = document.getElementById('admin-panel-room');
    panel.classList.add('hidden');
}

function toggleAdminPanel() {
    if (!state.isAdmin) {
        showAdminLoginModal();
        return;
    }
    const panel = document.getElementById('admin-panel-room');
    if (panel.classList.contains('hidden')) {
        showAdminPanel();
    } else {
        hideAdminPanel();
    }
}

function updateAdminPanel() {
    if (!state.isAdmin) return;
    
    // 更新踢人列表
    const kickList = document.getElementById('admin-kick-list');
    if (kickList) {
        kickList.innerHTML = '';
        state.players.forEach(p => {
            if (p.name !== state.playerName) {
                const btn = document.createElement('button');
                btn.className = 'admin-kick-btn';
                btn.innerHTML = `🚫 ${p.name}`;
                btn.addEventListener('click', () => adminKickPlayer(p.name));
                kickList.appendChild(btn);
            }
        });
        if (state.players.filter(p => p.name !== state.playerName).length === 0) {
            kickList.innerHTML = '<span class="text-white/30 text-xs">暂无其他玩家</span>';
        }
    }
    
    // 更新筹码目标下拉框
    const targetSelect = document.getElementById('admin-chips-target');
    if (targetSelect) {
        const currentVal = targetSelect.value;
        targetSelect.innerHTML = '<option value="">选择玩家</option>';
        state.players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (💰${p.chips})`;
            targetSelect.appendChild(opt);
        });
        if (currentVal) targetSelect.value = currentVal;
    }
}

function adminKickPlayer(targetName) {
    if (!state.isAdmin) return;
    if (!confirm(`确定要踢出 ${targetName} 吗？`)) return;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'admin_kick', target: targetName }));
    }
}

function adminAddChips(isAdd) {
    if (!state.isAdmin) return;
    const target = document.getElementById('admin-chips-target').value;
    const amount = parseInt(document.getElementById('admin-chips-amount').value) || 0;
    if (!target) {
        showToast('请选择玩家');
        return;
    }
    if (amount <= 0) {
        showToast('请输入有效金额');
        return;
    }
    const finalAmount = isAdd ? amount : -amount;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'admin_add_chips', target: target, amount: finalAmount }));
    }
}

function adminForceReady() {
    if (!state.isAdmin) return;
    if (!confirm('确定要强制全员准备并开始游戏吗？')) return;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'admin_force_ready' }));
    }
}

function copyInviteLink() {
    const baseUrl = window.location.origin + window.location.pathname;
    const link = `${baseUrl}?room=${state.roomCode}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            showToast('✅ 邀请链接已复制，发给朋友吧！');
        }).catch(() => fallbackCopy(link));
    } else {
        fallbackCopy(link);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('✅ 邀请链接已复制！');
    } catch(e) {
        showToast('复制失败，房间号: ' + state.roomCode);
    }
    document.body.removeChild(textarea);
}

function backToRoom() {
    const modal = document.getElementById('result-modal');
    const content = document.getElementById('result-content');
    content.classList.remove('result-show');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
    switchPage('room');
    connectWebSocket();
}

// ==================== 智能提示出牌 ====================
function getValuesCount(cards) {
    const count = {};
    cards.forEach(c => {
        const v = c.substring(1);
        count[v] = (count[v] || 0) + 1;
    });
    return count;
}

function findCardsOfValue(hand, value, num) {
    return hand.filter(c => c.substring(1) === value).slice(0, num);
}

function hintPlay() {
    if (state.myCards.length === 0) return;
    state.selectedCards = [];

    const hand = sortCards(state.myCards);
    const vc = getValuesCount(hand);

    if (state.isNewRound || !state.lastPlay) {
        // 新一轮：出最小的单张
        state.selectedCards = [hand[0]];
    } else {
        const lastType = state.lastPlayType;
        const lastCards = state.lastPlay;
        const lastVc = getValuesCount(lastCards);

        if (lastType === 'single') {
            const lastRank = CARD_ORDER[lastCards[0].substring(1)];
            for (const card of hand) {
                if (CARD_ORDER[card.substring(1)] > lastRank) {
                    state.selectedCards = [card];
                    break;
                }
            }
        } else if (lastType === 'pair') {
            const lastRank = CARD_ORDER[lastCards[0].substring(1)];
            const vals = Object.entries(vc).filter(([v, c]) => c >= 2 && CARD_ORDER[v] > lastRank);
            vals.sort((a, b) => CARD_ORDER[a[0]] - CARD_ORDER[b[0]]);
            if (vals.length > 0) {
                state.selectedCards = findCardsOfValue(hand, vals[0][0], 2);
            }
        } else if (lastType === 'triple') {
            const lastRank = CARD_ORDER[lastCards[0].substring(1)];
            const vals = Object.entries(vc).filter(([v, c]) => c >= 3 && CARD_ORDER[v] > lastRank);
            vals.sort((a, b) => CARD_ORDER[a[0]] - CARD_ORDER[b[0]]);
            if (vals.length > 0) {
                state.selectedCards = findCardsOfValue(hand, vals[0][0], 3);
            }
        } else if (lastType === 'triple_two') {
            const lastThree = Object.entries(lastVc).find(([v, c]) => c === 3);
            const lastRank = CARD_ORDER[lastThree[0]];
            const threeVals = Object.entries(vc).filter(([v, c]) => c >= 3 && CARD_ORDER[v] > lastRank);
            threeVals.sort((a, b) => CARD_ORDER[a[0]] - CARD_ORDER[b[0]]);
            if (threeVals.length > 0) {
                const tripleCards = findCardsOfValue(hand, threeVals[0][0], 3);
                // 找两张带牌
                const remaining = hand.filter(c => !tripleCards.includes(c));
                if (remaining.length >= 2) {
                    state.selectedCards = [...tripleCards, remaining[0], remaining[1]];
                }
            }
        } else if (lastType === 'bomb_solo' || lastType === 'bomb_pure') {
            // 尝试找更大的炸弹
            const lastFour = Object.entries(lastVc).find(([v, c]) => c === 4);
            const lastRank = CARD_ORDER[lastFour[0]];
            if (lastType === 'bomb_solo') {
                // 纯炸可以打四带一
                const pureVals = Object.entries(vc).filter(([v, c]) => c >= 4);
                pureVals.sort((a, b) => CARD_ORDER[a[0]] - CARD_ORDER[b[0]]);
                if (pureVals.length > 0) {
                    state.selectedCards = findCardsOfValue(hand, pureVals[0][0], 4);
                }
            } else {
                // 纯炸打纯炸，需要更大
                const pureVals = Object.entries(vc).filter(([v, c]) => c >= 4 && CARD_ORDER[v] > lastRank);
                pureVals.sort((a, b) => CARD_ORDER[a[0]] - CARD_ORDER[b[0]]);
                if (pureVals.length > 0) {
                    state.selectedCards = findCardsOfValue(hand, pureVals[0][0], 4);
                }
            }
        } else {
            // 其他牌型尝试找炸弹
            const bombVals = Object.entries(vc).filter(([v, c]) => c >= 4);
            if (bombVals.length > 0) {
                bombVals.sort((a, b) => CARD_ORDER[a[0]] - CARD_ORDER[b[0]]);
                state.selectedCards = findCardsOfValue(hand, bombVals[0][0], 4);
            }
        }
    }

    if (state.selectedCards.length === 0) {
        showToast('💡 没有找到合适的牌，请自行选择或不出');
    } else {
        showToast('💡 已为你推荐出牌');
    }
    renderMyHand();
}

// ==================== 事件绑定 ====================
function initEvents() {
    document.getElementById('btn-create').addEventListener('click', createRoom);
    document.getElementById('btn-join').addEventListener('click', joinRoom);
    document.getElementById('btn-solo').addEventListener('click', startSolo);
    document.getElementById('btn-ready').addEventListener('click', toggleReady);
    document.getElementById('btn-leave').addEventListener('click', leaveRoom);
    document.getElementById('btn-copy-link').addEventListener('click', copyInviteLink);
    document.getElementById('btn-play').addEventListener('click', playCards);
    document.getElementById('btn-pass').addEventListener('click', passPlay);
    document.getElementById('btn-hint').addEventListener('click', hintPlay);
    document.getElementById('btn-back-room').addEventListener('click', backToRoom);

    // 筹码按钮
    document.getElementById('chips-100').addEventListener('click', () => selectChips(100));
    document.getElementById('chips-200').addEventListener('click', () => selectChips(200));

    // 聊天
    document.getElementById('btn-chat-room').addEventListener('click', () => sendChat('room'));
    document.getElementById('chat-input-room').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') sendChat('room');
    });
    document.getElementById('btn-chat-game').addEventListener('click', () => sendChat('game'));
    document.getElementById('chat-input-game').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') sendChat('game');
    });

    // 游戏内聊天切换
    document.getElementById('game-chat-toggle').addEventListener('click', () => {
        document.getElementById('game-chat-panel').classList.toggle('hidden');
    });
    const chatClose = document.getElementById('game-chat-close');
    if (chatClose) {
        chatClose.addEventListener('click', () => {
            document.getElementById('game-chat-panel').classList.add('hidden');
        });
    }

    // Tab切换
    document.getElementById('tab-create').addEventListener('click', () => switchTab('create'));
    document.getElementById('tab-join').addEventListener('click', () => switchTab('join'));
    document.getElementById('tab-solo').addEventListener('click', () => switchTab('solo'));

    // URL参数支持邀请链接
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
        switchTab('join');
        document.getElementById('join-code').value = roomCode;
    }

    // 回车快捷键
    document.getElementById('create-name').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') document.getElementById('create-room-name').focus();
    });
    document.getElementById('create-room-name').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') createRoom();
    });
    document.getElementById('join-name').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') document.getElementById('join-code').focus();
    });
    document.getElementById('join-code').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    document.getElementById('solo-name').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') startSolo();
    });

    // 初始化背景粒子
    initParticles();

    // 音乐控制
    function toggleMusic(btn) {
        AudioSystem.init();
        const playing = AudioSystem.toggleBGM();
        // 更新所有音乐按钮的状态
        document.querySelectorAll('.music-btn').forEach(b => {
            b.textContent = playing ? '🔊' : '🎵';
            if (playing) {
                b.classList.add('playing');
            } else {
                b.classList.remove('playing');
            }
        });
    }
    const musicBtnGame = document.getElementById('btn-music');
    const musicBtnGlobal = document.getElementById('btn-music-global');
    if (musicBtnGame) musicBtnGame.addEventListener('click', () => toggleMusic(musicBtnGame));
    if (musicBtnGlobal) musicBtnGlobal.addEventListener('click', () => toggleMusic(musicBtnGlobal));

    // 点击任意位置初始化 AudioContext（浏览器要求用户交互后才能播放音频）
    document.addEventListener('click', () => { AudioSystem.init(); }, { once: true });

    // 管理员相关事件
    document.getElementById('btn-admin-login-room').addEventListener('click', () => {
        if (state.isAdmin) {
            toggleAdminPanel();
        } else {
            showAdminLoginModal();
        }
    });
    document.getElementById('btn-admin-cancel').addEventListener('click', hideAdminLoginModal);
    document.getElementById('btn-admin-confirm').addEventListener('click', submitAdminLogin);
    document.getElementById('admin-password-input').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') submitAdminLogin();
    });
    document.getElementById('btn-admin-panel-close').addEventListener('click', hideAdminPanel);
    document.getElementById('btn-admin-add-chips').addEventListener('click', () => adminAddChips(true));
    document.getElementById('btn-admin-sub-chips').addEventListener('click', () => adminAddChips(false));
    document.getElementById('btn-admin-force-ready').addEventListener('click', adminForceReady);
    document.getElementById('btn-open-admin').addEventListener('click', toggleAdminPanel);
}

document.addEventListener('DOMContentLoaded', initEvents);
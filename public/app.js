/* global io */

const socket = io();

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

const $ = (id) => document.getElementById(id);

// ---------- Estado local ----------
let selectedColor = localStorage.getItem('ttt_color') || COLORS[3];
let currentState = null;
let toastTimer = null;

// ---------- Boot ----------

document.addEventListener('DOMContentLoaded', () => {
  renderColorPicker();
  bindLogin();
  bindGame();

  const savedName = localStorage.getItem('ttt_name');
  if (savedName) {
    $('name-input').value = savedName;
    // Auto-rejoin ao recarregar / reconectar
    socket.emit('join', { name: savedName, color: selectedColor });
  }
});

// ---------- Login ----------

function renderColorPicker() {
  const picker = $('color-picker');
  picker.innerHTML = '';
  COLORS.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'color-opt' + (c === selectedColor ? ' selected' : '');
    el.style.background = c;
    el.onclick = () => {
      selectedColor = c;
      localStorage.setItem('ttt_color', c);
      renderColorPicker();
    };
    picker.appendChild(el);
  });
}

function bindLogin() {
  $('join-btn').onclick = () => {
    const name = $('name-input').value.trim();
    if (!name) {
      $('login-error').textContent = 'Digite seu nome';
      return;
    }
    $('login-error').textContent = '';
    localStorage.setItem('ttt_name', name);
    localStorage.setItem('ttt_color', selectedColor);
    socket.emit('join', { name, color: selectedColor });
  };

  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('join-btn').click();
  });
}

// ---------- Jogo ----------

function bindGame() {
  $('leave-btn').onclick = () => {
    if (confirm('Sair do torneio? Suas vitórias ficam salvas sob o nome.')) {
      localStorage.removeItem('ttt_name');
      location.reload();
    }
  };
}

// ---------- Socket ----------

socket.on('connect', () => {
  // Reentra automaticamente se já tinha nome salvo
  const savedName = localStorage.getItem('ttt_name');
  if (savedName) {
    socket.emit('join', { name: savedName, color: selectedColor });
  }
});

socket.on('state', (state) => {
  currentState = state;
  render(state);
});

socket.on('error', (msg) => {
  $('login-error').textContent = msg;
  toast(msg);
});

// ---------- Render ----------

function render(state) {
  if (state.you) {
    $('login-screen').classList.add('hidden');
    $('game-screen').classList.remove('hidden');
    renderMe(state);
    renderMatch(state);
    renderChampion(state);
    renderQueue(state);
  } else {
    $('login-screen').classList.remove('hidden');
    $('game-screen').classList.add('hidden');
  }
}

function renderMe(state) {
  $('me-dot').style.background = state.you.color;
  $('me-name').textContent = state.you.name;
  $('me-wins').textContent = state.you.wins;
}

function renderMatch(state) {
  const board = $('board');
  const match = state.currentMatch;

  // Reconstrói o tabuleiro apenas se necessário (evita perder animações)
  if (!match) {
    $('match-info').textContent = state.queue.length + (state.players.length < 2)
      ? 'Aguardando mais jogadores…'
      : 'Aguardando próxima partida…';
    $('turn-info').textContent = '';
    board.innerHTML = '';
    for (let i = 0; i < 9; i++) board.appendChild(makeCell(i, null, state, null));
    return;
  }

  const colorX = playerColor(state, match.playerX);
  const colorO = playerColor(state, match.playerO);

  $('match-info').textContent =
    `${match.playerX} vs ${match.playerO}` +
    (match.finished && match.winner && match.winner !== 'draw'
      ? `  —  🏆 ${match.winner === 'X' ? match.playerX : match.playerO}`
      : match.finished && match.winner === 'draw'
        ? '  —  Empate!'
        : '');

  // Tabuleiro
  board.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const symbol = match.board[i];
    board.appendChild(makeCell(i, symbol, state, match));
  }

  // Turno
  if (match.finished) {
    $('turn-info').textContent = '';
  } else {
    const turnPlayer = match.turn === 'X' ? match.playerX : match.playerO;
    const isMyTurn = state.you && state.you.symbol === match.turn;
    $('turn-info').textContent = isMyTurn
      ? '👉 É a sua vez!'
      : `Vez de ${turnPlayer}`;
  }
}

function makeCell(index, symbol, state, match) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  if (symbol) cell.classList.add('taken');

  if (symbol) {
    cell.textContent = symbol;
    cell.style.color = playerColor(state, symbol === 'X' ? match.playerX : match.playerO);
  }

  // Destaque da linha vencedora
  if (match && match.winLine && match.winLine.includes(index)) {
    cell.classList.add('win');
  }

  const isMyTurn =
    state.you &&
    match &&
    !match.finished &&
    state.you.symbol === match.turn;

  if (isMyTurn && !symbol) {
    cell.classList.add('mine');
    cell.onclick = () => socket.emit('move', { index });
  }

  return cell;
}

function playerColor(state, name) {
  const p = state.players.find((pl) => pl.name === name);
  return p ? p.color : '#888';
}

function renderChampion(state) {
  const el = $('champion');
  if (!state.champion) {
    el.innerHTML = '<span class="muted">Aguardando…</span>';
    return;
  }
  const p = state.players.find((pl) => pl.name === state.champion);
  if (!p) {
    el.innerHTML = '<span class="muted">—</span>';
    return;
  }
  el.innerHTML = `
    <span class="dot" style="background:${p.color}"></span>
    <span>${escapeHtml(p.name)}</span>
    <span class="muted" style="margin-left:auto;font-weight:600">🏆 ${p.wins}</span>
  `;
}

function renderQueue(state) {
  const list = $('queue');
  const empty = $('queue-empty');
  list.innerHTML = '';

  if (state.queue.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  state.queue.forEach((name, i) => {
    const p = state.players.find((pl) => pl.name === name) || {};
    const li = document.createElement('li');
    if (p.connected === false) li.classList.add('offline');
    li.innerHTML = `
      <span class="pos">${i + 1}</span>
      <span class="dot" style="background:${p.color || '#ccc'};width:12px;height:12px"></span>
      <span class="name">${escapeHtml(name)}</span>
      <span class="wins-badge">🏆 ${p.wins ?? 0}</span>
    `;
    list.appendChild(li);
  });
}

// ---------- Toast ----------

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
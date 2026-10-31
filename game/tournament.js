const { createBoard, checkResult, applyMove, nextTurn } = require('./ticTacToe');

const INACTIVITY_TIMEOUT_MS = 15 * 1000;    // 15s offline → perde a vez
const END_MATCH_DELAY_MS = 3000;            // pausa para mostrar resultado

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

class Tournament {
  constructor(broadcast = () => {}) {
    this.broadcast = broadcast;
    this.players = new Map();
    this.queue = [];
    this.champion = null;
    this.currentMatch = null;
    this.history = [];
  }

  // ---------- Entrada / saída de jogadores ----------

  join(name, color, socketId) {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return { error: 'Nome inválido' };

    let player = this.players.get(name);

    if (!player) {
      player = {
        name,
        color: this._validColor(color) || this._randomColor(),
        wins: 0,
        socketId,
        connected: true,
        disconnectTimer: null,
      };
      this.players.set(name, player);
    } else {
      if (player.connected && player.socketId !== socketId) {
        return { error: 'Este nome já está em uso' };
      }
      player.socketId = socketId;
      player.connected = true;
      if (this._validColor(color)) player.color = color;
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }
    }

    const inMatch = this.currentMatch &&
      (this.currentMatch.playerX === name || this.currentMatch.playerO === name);
    const inQueue = this.queue.includes(name);
    const isChampion = this.champion === name;

    if (!inMatch && !inQueue && !isChampion) {
      this.queue.push(name);
    }

    // Sempre tenta iniciar (cobre campeão reconectando com fila esperando)
    this._tryStartNextMatch();

    return { ok: true };
  }

  disconnect(name, socketId) {
    const player = this.players.get(name);
    if (!player || player.socketId !== socketId) return;

    player.connected = false;
    player.socketId = null;

    player.disconnectTimer = setTimeout(() => {
      this._handleDisconnectTimeout(name);
    }, INACTIVITY_TIMEOUT_MS);
  }

  _handleDisconnectTimeout(name) {
    const player = this.players.get(name);
    if (!player || player.connected) return;

    // Em partida ainda em andamento → substituição pelo próximo da fila
    if (this.currentMatch && !this.currentMatch.finished) {
      const inThisMatch =
        this.currentMatch.playerX === name || this.currentMatch.playerO === name;
      if (inThisMatch) {
        this._handleMatchForfeit(name);
        return;
      }
    }

    if (this.champion === name) this.champion = null;

    const idx = this.queue.indexOf(name);
    if (idx !== -1) this.queue.splice(idx, 1);

    this._tryStartNextMatch();
    this.broadcast();
  }

  /**
   * Jogador em partida ficou offline por mais de INACTIVITY_TIMEOUT_MS.
   * Ele "perde a vez": o adversário continua e o próximo da fila assume o
   * lugar de quem caiu (nova partida). Sem próximo, o adversário vira campeão.
   */
  _handleMatchForfeit(name) {
    const match = this.currentMatch;
    if (!match) return;

    if (this.champion === name) this.champion = null;

    const remainingName =
      match.playerX === name ? match.playerO : match.playerX;
    const remaining = this.players.get(remainingName);

    this.history.push({
      ...match,
      winner: null,
      forfeitedBy: name,
      cancelled: true,
      finished: true,
    });
    if (this.history.length > 20) this.history.shift();

    this.currentMatch = null;

    // Se o outro também caiu, apenas tenta próximo
    if (!remaining || !remaining.connected) {
      this._tryStartNextMatch();
      this.broadcast();
      return;
    }

    const nextChallenger = this._takeNextConnectedFromQueue();
    this.champion = remainingName;

    if (nextChallenger) {
      this._startMatch(remainingName, nextChallenger);
    }

    this.broadcast();
  }

  // ---------- Jogadas ----------

  makeMove(name, index) {
    if (!this.currentMatch) return { error: 'Nenhuma partida em andamento' };
    const match = this.currentMatch;
    if (match.finished) return { error: 'Partida já terminou' };

    let symbol = null;
    if (match.playerX === name) symbol = 'X';
    else if (match.playerO === name) symbol = 'O';
    else return { error: 'Você não está nesta partida' };

    if (match.turn !== symbol) return { error: 'Não é sua vez' };

    const next = applyMove(match.board, index, symbol);
    if (!next) return { error: 'Jogada inválida' };

    match.board = next;
    const result = checkResult(next);

    if (!result) {
      match.turn = nextTurn(match.turn);
      return { ok: true };
    }

    if (result.winner === 'draw') {
      match.winner = 'draw';
      match.finished = true;
      setTimeout(() => this._handleDraw(match), END_MATCH_DELAY_MS);
      return { ok: true };
    }

    match.winner = result.winner;
    match.winLine = result.line;
    match.finished = true;

    const winnerName = result.winner === 'X' ? match.playerX : match.playerO;
    setTimeout(() => this._finishMatch(match, winnerName), END_MATCH_DELAY_MS);

    return { ok: true };
  }

  _finishMatch(match, winnerName) {
    // Ignora se a partida já foi substituída/cancelada
    if (this.currentMatch !== match) return;

    const winner = this.players.get(winnerName);
    if (winner) winner.wins++;

    const loser =
      match.playerX === winnerName ? match.playerO : match.playerX;

    this.history.push({ ...match, winner: winnerName, loser });
    if (this.history.length > 20) this.history.shift();

    this.currentMatch = null;
    this.champion = winnerName;

    if (this.players.has(loser)) this.queue.push(loser);

    this._tryStartNextMatch();
    this.broadcast();
  }

  /** Empate: os dois voltam para o fim da fila (ninguém mantém o título). */
  _handleDraw(match) {
    if (this.currentMatch !== match) return;

    this.history.push({ ...match, winner: 'draw' });
    if (this.history.length > 20) this.history.shift();

    this.currentMatch = null;
    this.champion = null;

    for (const name of [match.playerX, match.playerO]) {
      if (this.players.has(name)) this.queue.push(name);
    }

    this._tryStartNextMatch();
    this.broadcast();
  }

  _tryStartNextMatch() {
    if (this.currentMatch) return;

    // Caso 1: campeão conectado + desafiante conectado na fila
    if (this.champion) {
      const champ = this.players.get(this.champion);
      if (champ && champ.connected) {
        const challenger = this._takeNextConnectedFromQueue();
        if (challenger) this._startMatch(this.champion, challenger);
      }
      return;
    }

    // Caso 2: sem campeão, dois conectados na fila
    const idxs = [];
    for (let i = 0; i < this.queue.length && idxs.length < 2; i++) {
      const p = this.players.get(this.queue[i]);
      if (p && p.connected) idxs.push(i);
    }
    if (idxs.length < 2) return;

    const [i1, i2] = idxs;
    const p2 = this.queue.splice(i2, 1)[0];
    const p1 = this.queue.splice(i1, 1)[0];
    this._startMatch(p1, p2);
  }

  _startMatch(playerX, playerO) {
    if (!this.players.has(playerX) || !this.players.has(playerO)) return;
    this.currentMatch = {
      playerX,
      playerO,
      board: createBoard(),
      turn: 'X',
      winner: null,
      winLine: null,
      finished: false,
    };
  }

  /** Remove e devolve o primeiro jogador conectado da fila, ou null. */
  _takeNextConnectedFromQueue() {
    for (let i = 0; i < this.queue.length; i++) {
      const p = this.players.get(this.queue[i]);
      if (p && p.connected) {
        return this.queue.splice(i, 1)[0];
      }
    }
    return null;
  }

  // ---------- Views ----------

  getPublicState() {
    return {
      players: Array.from(this.players.values()).map((p) => ({
        name: p.name,
        color: p.color,
        wins: p.wins,
        connected: p.connected,
      })),
      queue: this.queue.slice(),
      champion: this.champion,
      currentMatch: this.currentMatch,
      history: this.history.slice(-5),
    };
  }

  getStateFor(name) {
    const base = this.getPublicState();
    const player = name ? this.players.get(name) : null;
    if (!player) return { ...base, you: null };

    let symbol = null;
    if (this.currentMatch) {
      if (this.currentMatch.playerX === name) symbol = 'X';
      else if (this.currentMatch.playerO === name) symbol = 'O';
    }

    return {
      ...base,
      you: {
        name: player.name,
        color: player.color,
        wins: player.wins,
        symbol,
        isChampion: this.champion === name,
        inQueue: this.queue.includes(name),
        connected: player.connected,
      },
    };
  }

  // ---------- Helpers ----------

  _validColor(c) {
    return COLORS.includes(c) ? c : null;
  }

  _randomColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
}

module.exports = Tournament;

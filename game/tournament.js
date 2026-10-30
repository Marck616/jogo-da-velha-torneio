const { createBoard, checkResult, applyMove, nextTurn } = require('./ticTacToe');

const RECONNECT_GRACE_MS = 60 * 1000;       // 60s para reconectar
const END_MATCH_DELAY_MS = 3000;            // pausa para mostrar resultado

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

class Tournament {
  /**
   * @param {() => void} broadcast callback chamado sempre que o estado muda
   *                              por causa de um timer interno (desconexão etc.)
   */
  constructor(broadcast = () => {}) {
    this.broadcast = broadcast;
    this.players = new Map();       // name -> { name, color, wins, socketId, connected, disconnectTimer }
    this.queue = [];                // [name, ...]  ordem de quem espera jogar
    this.champion = null;           // name do vencedor atual esperando desafiante
    this.currentMatch = null;       // { playerX, playerO, board, turn, winner, winLine, finished }
    this.history = [];              // últimas partidas
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

    // Se não está em partida, fila ou como campeão, coloca no torneio
    const inMatch = this.currentMatch &&
      (this.currentMatch.playerX === name || this.currentMatch.playerO === name);
    const inQueue = this.queue.includes(name);
    const isChampion = this.champion === name;

    if (!inMatch && !inQueue && !isChampion) {
      this.queue.push(name);
      this._tryStartNextMatch();
    }

    return { ok: true };
  }

  disconnect(name, socketId) {
    const player = this.players.get(name);
    if (!player || player.socketId !== socketId) return;

    player.connected = false;
    player.socketId = null;

    // Período de graça para reconectar
    player.disconnectTimer = setTimeout(() => {
      this._handleDisconnectTimeout(name);
    }, RECONNECT_GRACE_MS);
  }

  _handleDisconnectTimeout(name) {
    const player = this.players.get(name);
    if (!player || player.connected) return;

    // Se estava em partida
    if (this.currentMatch) {
      const isX = this.currentMatch.playerX === name;
      const isO = this.currentMatch.playerO === name;
      if (isX || isO) {
        const oppName = isX ? this.currentMatch.playerO : this.currentMatch.playerX;
        const opp = this.players.get(oppName);
        if (opp && opp.connected) {
          this._finishMatch(oppName);
          return;
        }
        // Ambos desconectados -> cancela a partida
        this.history.push({
          ...this.currentMatch,
          winner: null,
          cancelled: true,
        });
        this.currentMatch = null;
      }
    }

    // Se era campeão, perde o posto
    if (this.champion === name) this.champion = null;

    // Sai da fila
    const idx = this.queue.indexOf(name);
    if (idx !== -1) this.queue.splice(idx, 1);

    this._tryStartNextMatch();
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
      this.history.push({ ...match });
      setTimeout(() => this._rematchDraw(match), END_MATCH_DELAY_MS);
      return { ok: true };
    }

    // Alguém venceu
    match.winner = result.winner;
    match.winLine = result.line;
    match.finished = true;

    const winnerName =
      result.winner === 'X' ? match.playerX : match.playerO;

    setTimeout(() => this._finishMatch(winnerName), END_MATCH_DELAY_MS);

    return { ok: true };
  }

  _finishMatch(winnerName) {
    const match = this.currentMatch;
    if (!match) return;

    const winner = this.players.get(winnerName);
    if (winner) winner.wins++;

    // O perdedor volta para o fim da fila (para poder jogar de novo)
    const loser =
      match.playerX === winnerName ? match.playerO : match.playerX;

    this.history.push({ ...match, winner: winnerName, loser });
    if (this.history.length > 20) this.history.shift();

    this.currentMatch = null;
    this.champion = winnerName;

    // Perdedor volta para a fila se ainda estiver por aqui
    if (this.players.has(loser)) this.queue.push(loser);

    this._tryStartNextMatch();
    this.broadcast();
  }

  _rematchDraw(match) {
    // Empatou: mesma dupla, invertendo quem começa
    this.history.push({ ...match, winner: 'draw' });
    this.currentMatch = {
      playerX: match.playerO,
      playerO: match.playerX,
      board: createBoard(),
      turn: 'X',
      winner: null,
      winLine: null,
      finished: false,
    };
    this.broadcast();
  }

  _tryStartNextMatch() {
    if (this.currentMatch) return;

    // Caso 1: campeão + desafiante na fila
    if (this.champion && this.queue.length > 0) {
      const challenger = this.queue.shift();
      this._startMatch(this.champion, challenger);
      return;
    }

    // Caso 2: sem campeão, dois na fila
    if (!this.champion && this.queue.length >= 2) {
      const p1 = this.queue.shift();
      const p2 = this.queue.shift();
      this._startMatch(p1, p2);
    }
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
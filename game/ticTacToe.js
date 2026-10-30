// Regras puras do Jogo da Velha. Não sabe nada sobre torneio/jogadores.

function createBoard() {
  return Array(9).fill(null);
}

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // linhas
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // colunas
  [0, 4, 8], [2, 4, 6],            // diagonais
];

/**
 * Verifica o resultado do tabuleiro.
 * @returns null | { winner: 'X'|'O', line: number[] } | { winner: 'draw', line: null }
 */
function checkResult(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((cell) => cell !== null)) {
    return { winner: 'draw', line: null };
  }
  return null;
}

/**
 * Aplica uma jogada em um novo tabuleiro. Retorna null se inválida.
 */
function applyMove(board, index, symbol) {
  if (!Number.isInteger(index) || index < 0 || index > 8) return null;
  if (board[index] !== null) return null;
  const next = board.slice();
  next[index] = symbol;
  return next;
}

function nextTurn(turn) {
  return turn === 'X' ? 'O' : 'X';
}

module.exports = { createBoard, checkResult, applyMove, nextTurn };
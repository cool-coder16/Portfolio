// --- The board ---
// board[row][col] — row 0 is the TOP row, row ROWS - 1 is the bottom.
// Pieces fall, so dropping into a column always lands in the LOWEST empty
// row of that column, same as the real game.
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER = 1; // you — red
const AI = 2; // the minimax opponent — yellow

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

// Used everywhere a move needs to be tried out without touching the real
// game board — minimax especially, since it has to explore many
// hypothetical futures without disturbing the actual game in progress.
function copyBoard(board) {
  return board.map((row) => row.slice());
}

function getLowestEmptyRow(board, col) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === EMPTY) return row;
  }
  return -1; // column full
}

// Mutates board directly. Returns the row the piece landed in, or null if
// the column was already full (caller's responsibility to check first, or
// handle the null).
function dropPiece(board, col, player) {
  const row = getLowestEmptyRow(board, col);
  if (row === -1) return null;
  board[row][col] = player;
  return row;
}

function getValidColumns(board) {
  const columns = [];
  for (let col = 0; col < COLS; col++) {
    if (board[0][col] === EMPTY) columns.push(col);
  }
  return columns;
}

function isBoardFull(board) {
  return getValidColumns(board).length === 0;
}

// Checks every possible 4-in-a-row (horizontal, vertical, both
// diagonals). Returns PLAYER or AI if one of them has won, otherwise null.
function checkWinner(board) {
  // horizontal
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const cell = board[row][col];
      if (
        cell !== EMPTY &&
        cell === board[row][col + 1] &&
        cell === board[row][col + 2] &&
        cell === board[row][col + 3]
      ) {
        return cell;
      }
    }
  }
  // vertical
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      const cell = board[row][col];
      if (
        cell !== EMPTY &&
        cell === board[row + 1][col] &&
        cell === board[row + 2][col] &&
        cell === board[row + 3][col]
      ) {
        return cell;
      }
    }
  }
  // diagonal, down-right
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const cell = board[row][col];
      if (
        cell !== EMPTY &&
        cell === board[row + 1][col + 1] &&
        cell === board[row + 2][col + 2] &&
        cell === board[row + 3][col + 3]
      ) {
        return cell;
      }
    }
  }
  // diagonal, down-left
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 3; col < COLS; col++) {
      const cell = board[row][col];
      if (
        cell !== EMPTY &&
        cell === board[row + 1][col - 1] &&
        cell === board[row + 2][col - 2] &&
        cell === board[row + 3][col - 3]
      ) {
        return cell;
      }
    }
  }
  return null;
}

// --- Position evaluation ---
// Used at the bottom of minimax's search — once depth runs out, there's no
// more looking ahead, so the position has to be estimated instead of known
// for sure. Slides every possible 4-in-a-row "window" across the board and
// scores each one: heavily rewards windows AI could still complete (more
// AI pieces already in it = better), and mirrors that as a penalty for the
// opponent. A small center-column bonus is added on top, since center
// pieces take part in more possible 4-in-a-rows than edge pieces do.
function scoreWindow(cells) {
  const aiCount = cells.filter((c) => c === AI).length;
  const playerCount = cells.filter((c) => c === PLAYER).length;
  const emptyCount = cells.filter((c) => c === EMPTY).length;

  if (aiCount > 0 && playerCount > 0) return 0; // blocked — neither side can complete this one

  if (aiCount === 4) return 100000;
  if (aiCount === 3 && emptyCount === 1) return 50;
  if (aiCount === 2 && emptyCount === 2) return 10;

  if (playerCount === 4) return -100000;
  if (playerCount === 3 && emptyCount === 1) return -50;
  if (playerCount === 2 && emptyCount === 2) return -10;

  return 0;
}

function evaluateBoard(board) {
  let score = 0;
  const centerCol = 3;

  for (let row = 0; row < ROWS; row++) {
    if (board[row][centerCol] === AI) score += 3;
    else if (board[row][centerCol] === PLAYER) score -= 3;
  }

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      score += scoreWindow([
        board[row][col],
        board[row][col + 1],
        board[row][col + 2],
        board[row][col + 3],
      ]);
    }
  }
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      score += scoreWindow([
        board[row][col],
        board[row + 1][col],
        board[row + 2][col],
        board[row + 3][col],
      ]);
    }
  }
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      score += scoreWindow([
        board[row][col],
        board[row + 1][col + 1],
        board[row + 2][col + 2],
        board[row + 3][col + 3],
      ]);
    }
  }
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 3; col < COLS; col++) {
      score += scoreWindow([
        board[row][col],
        board[row + 1][col - 1],
        board[row + 2][col - 2],
        board[row + 3][col - 3],
      ]);
    }
  }

  return score;
}

// --- Minimax (YOU write this) ---
// board: the position to evaluate. depth: how many more moves to look
// ahead before giving up and estimating instead (0 means "stop here").
// isMaximizing: true if it's AI's turn to move at this position (trying
// to pick the HIGHEST score), false if it's the opponent's turn (trying
// to pick the LOWEST score, since a good move for them is bad for AI).
//
// Returns a number: the best score achievable from this position, this
// many moves ahead, assuming both sides always play their best move.
function minimax(board, depth, isMaximizing) {
  if (checkWinner(board) === AI) {
    return Infinity;
  } else if (checkWinner(board) === PLAYER) {
    return -Infinity;
  } else if (isBoardFull(board)) {
    return 0;
  } else if (depth === 0) {
    return evaluateBoard(board);
  }

  let bestScore = isMaximizing ? -Infinity : Infinity;
  for (const col of getValidColumns(board)) {
    const boardCopy = copyBoard(board);
    dropPiece(boardCopy, col, isMaximizing ? AI : PLAYER);
    score = minimax(boardCopy, depth - 1, !isMaximizing);
    if (isMaximizing) {
      bestScore = score > bestScore ? score : bestScore;
    } else {
      bestScore = score < bestScore ? score : bestScore;
    }
  }

  return bestScore;
}

// Tries every legal move for AI, asks minimax how good the position looks
// afterward, and returns whichever column led to the best one. This is
// the only thing that actually calls minimax() — everything else in this
// file just sets up positions for it to evaluate.
function getBestMove(board, depth) {
  let bestScore = -Infinity;
  let bestCol = null;

  for (const col of getValidColumns(board)) {
    const boardCopy = copyBoard(board);
    dropPiece(boardCopy, col, AI);
    const score = minimax(boardCopy, depth - 1, false);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }

  return bestCol;
}

// --- Game state ---
let board = createEmptyBoard();
let currentPlayer = PLAYER;
let gameOver = false;
let aiThinking = false;

function celebrate(message) {
  const readout = document.getElementById("gameReadout");
  readout.textContent = message;
  readout.classList.add("solved");
}

function setReadout(message) {
  const readout = document.getElementById("gameReadout");
  readout.textContent = message;
  readout.classList.remove("solved");
}

function newGame() {
  board = createEmptyBoard();
  currentPlayer = PLAYER;
  gameOver = false;
  aiThinking = false;
  setReadout("Your turn — click a column.");
  draw();
}

document.getElementById("newGameButton").addEventListener("click", newGame);

// Drops a piece for `player`, then handles whatever comes next: a win, a
// draw, or handing the turn to whoever's next (kicking off the AI's own
// move automatically if it's now AI's turn). Used for both the human's
// clicks and the AI's chosen move, so both go through identical
// win/draw/turn-passing logic.
function makeMove(col, player) {
  const row = dropPiece(board, col, player);
  if (row === null) return; // column full — ignore the click/move

  draw();

  const winner = checkWinner(board);
  if (winner) {
    gameOver = true;
    celebrate(`${winner === PLAYER ? "Red" : "Yellow"} wins!`);
    return;
  }
  if (isBoardFull(board)) {
    gameOver = true;
    celebrate("Draw!");
    return;
  }

  currentPlayer = player === PLAYER ? AI : PLAYER;

  if (currentPlayer === AI) {
    aiThinking = true;
    setReadout("Yellow is thinking...");
    // A brief pause even though the search itself might be near-instant
    // at low depths — instantaneous AI moves read as janky/unnatural, and
    // it gives the "thinking" message a moment to actually be visible.
    setTimeout(() => {
      const depth = Number(depthInput.value);
      const aiCol = getBestMove(board, depth);
      aiThinking = false;
      if (aiCol === null) {
        setReadout("AI couldn't find a move — check minimax().");
        return;
      }
      makeMove(aiCol, AI);
    }, 300);
  } else {
    setReadout("Your turn — click a column.");
  }
}

// --- Setup panel ---
const depthInput = document.getElementById("depthInput");
const depthValue = document.getElementById("depthValue");
depthInput.addEventListener("input", () => {
  depthValue.textContent = depthInput.value;
});

// --- Canvas ---
const canvas = document.getElementById("connectFourCanvas");
const ctx = canvas.getContext("2d");
const CELL_SIZE = canvas.width / COLS;
const HOVER_MARGIN = CELL_SIZE; // top strip reserved for the "about to drop" preview piece
const PIECE_RADIUS = CELL_SIZE / 2 - 6;

const RED = "#ff3b3b";
const YELLOW = "#ffcc33";

// The board frame and empty slots stay the same fixed colors regardless
// of theme — same reasoning as the sorting page's rainbow hues: a board
// game's board is part of its identity, not chrome that should shift.
const SCENE_THEME = {
  dark: { boardFrame: "#1a4d8f", emptySlot: "#1c212b" },
  light: { boardFrame: "#2b6cb0", emptySlot: "#ffffff" },
};

let hoveredCol = null;

function getColumnFromX(x) {
  const col = Math.floor(x / CELL_SIZE);
  return col >= 0 && col < COLS ? col : null;
}

canvas.addEventListener("mousemove", (event) => {
  hoveredCol = getColumnFromX(event.offsetX);
  draw();
});
canvas.addEventListener("mouseleave", () => {
  hoveredCol = null;
  draw();
});

canvas.addEventListener("click", (event) => {
  if (gameOver || currentPlayer !== PLAYER || aiThinking) return;
  const col = getColumnFromX(event.offsetX);
  if (col === null) return;
  makeMove(col, PLAYER);
});

function draw() {
  const theme = document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Hover preview — a translucent piece in the current player's color,
  // floating above whichever column the mouse is over.
  if (
    hoveredCol !== null &&
    !gameOver &&
    currentPlayer === PLAYER &&
    !aiThinking &&
    getLowestEmptyRow(board, hoveredCol) !== -1
  ) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(
      hoveredCol * CELL_SIZE + CELL_SIZE / 2,
      HOVER_MARGIN / 2,
      PIECE_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Board frame.
  ctx.fillStyle = theme.boardFrame;
  ctx.fillRect(0, HOVER_MARGIN, canvas.width, canvas.height - HOVER_MARGIN);

  // Slots — empty, or filled with whichever piece is there.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = col * CELL_SIZE + CELL_SIZE / 2;
      const cy = HOVER_MARGIN + row * CELL_SIZE + CELL_SIZE / 2;

      if (board[row][col] === EMPTY) {
        ctx.fillStyle = theme.emptySlot;
      } else if (board[row][col] === PLAYER) {
        ctx.fillStyle = RED;
      } else {
        ctx.fillStyle = YELLOW;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, PIECE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

draw();

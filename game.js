/**
 * Milo Pop Puzzle — Core Game Engine (Classic mode, v1)
 * ======================================================
 * Plain vanilla JavaScript. No dependencies, no Phaser needed for an 8x8
 * grid — keeps the web build tiny and fast (<2s on a cheap phone).
 *
 * Locked spec (2026-11-27): Classic mode ONLY. 8x8 board. Tray gives 3 pieces
 * at a time; 3 new pieces only when all 3 are placed. NO rotation.
 * Difficulty: ONLY Easy + Medium (Hard/Expert were removed by the owner).
 * Fair draw: piece feed is uniform random, never rigged — no difficulty
 * spike near high scores. No timer, no lives, no sign-in, no ads in web.
 * Undo / Hold / Hint are FREE. Best score + coins persist in localStorage.
 *
 * Exposed API (for Agent 2's UI):
 *   window.MiloPop = {
 *     newGame(difficulty)          // 'easy' | 'medium'
 *     canPlace(pieceIndex, row, col) -> bool
 *     placePiece(pieceIndex, row, col) -> result object or { ok:false, reason }
 *     findFits(pieceIndex)         -> [{row,col}, ...] all valid spots
 *     undo()                       -> { ok, undosLeft } | { ok:false, reason }
 *     hold(pieceIndex)             -> { ok, ... } | { ok:false, reason }
 *     hint()                       -> { pieceIndex, row, col } | null
 *     relaxRefresh()               -> { ok, clearedCells, rowsCleared } (Relax
 *                                     mode only: opens space when the tray no
 *                                     longer fits, instead of ending the game;
 *                                     emits 'relax-refresh')
 *     setCoins(v)                  -> { ok, coins } (bank reward coins
 *                                     into the engine's own counter)
 *     getState()                   -> snapshot (board, tray, nextTray, score...)
 *     onEvent(fn)                  -> subscribe; fn(event) receives events:
 *        {type:'place', piece, row, col, cellsPlaced, score}
 *        {type:'clear', cells:[{row,col}], lines, combo, points, coinsEarned}
 *        {type:'tray', tray, nextTray}
 *        {type:'undo', undosLeft} / {type:'hold', held, tray} / {type:'hint', ...}
 *        {type:'gameover', score, bestScore, isNewBest, coins, linesCleared}
 *        {type:'newgame', difficulty}
 *     createDragController(opts)   -> optional pointer drag helper (touch+mouse)
 *     SHAPES, COLORS, DIFFICULTIES // read-only constants for the UI
 *   }
 */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------- constants
  var BOARD_SIZE = 8;
  var TRAY_SIZE = 3;
  var STORE_PREFIX = 'milo-pop-';
  var STORE_BEST = STORE_PREFIX + 'best-score';
  var STORE_COINS = STORE_PREFIX + 'coins';
  var STORE_GAMES = STORE_PREFIX + 'games-played';

  // Candy colours — one solid colour per piece (plain glossy cubes, no
  // pictures inside, per the block-design research).
  var COLORS = ['red', 'blue', 'yellow', 'green', 'orange', 'purple'];

  // Piece shapes as lists of [row, col] offsets (top-left anchored).
  // Rotations are separate entries so the tray shows a fair mix.
  function shape(cells) { return cells.map(function (c) { return [c[0], c[1]]; }); }

  var SHAPES = {
    // 1 cell
    single: shape([[0, 0]]),
    // bars
    bar2h: shape([[0, 0], [0, 1]]),
    bar2v: shape([[0, 0], [1, 0]]),
    bar3h: shape([[0, 0], [0, 1], [0, 2]]),
    bar3v: shape([[0, 0], [1, 0], [2, 0]]),
    bar5h: shape([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]),
    bar5v: shape([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]),
    // squares
    square2: shape([[0, 0], [0, 1], [1, 0], [1, 1]]),
    square3: shape([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]),
    // small L (3 cells, 2x2 missing one corner) — 4 rotations
    cornerTL: shape([[0, 0], [0, 1], [1, 0]]),
    cornerTR: shape([[0, 0], [0, 1], [1, 1]]),
    cornerBL: shape([[0, 0], [1, 0], [1, 1]]),
    cornerBR: shape([[0, 1], [1, 0], [1, 1]]),
    // big L (5 cells, 3x3) — 4 rotations
    bigL1: shape([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]),
    bigL2: shape([[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]]),
    bigL3: shape([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]),
    bigL4: shape([[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]]),
    // T (4 cells) — 4 rotations
    tDown: shape([[0, 0], [0, 1], [0, 2], [1, 1]]),
    tUp: shape([[0, 1], [1, 0], [1, 1], [1, 2]]),
    tRight: shape([[0, 0], [1, 0], [1, 1], [2, 0]]),
    tLeft: shape([[0, 1], [1, 0], [1, 1], [2, 1]]),
    // zigzag / S (4 cells) — 4 orientations
    zigH1: shape([[0, 0], [0, 1], [1, 1], [1, 2]]),
    zigH2: shape([[0, 1], [0, 2], [1, 0], [1, 1]]),
    zigV1: shape([[0, 0], [1, 0], [1, 1], [2, 1]]),
    zigV2: shape([[0, 1], [1, 0], [1, 1], [2, 0]]),
    // plus (5 cells)
    plus: shape([[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]),
    // U (5 cells) — 4 rotations
    uUp: shape([[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]]),
    uDown: shape([[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]]),
    uLeft: shape([[0, 0], [0, 1], [1, 1], [2, 0], [2, 1]]),
    uRight: shape([[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]])
  };

  // Easy (kids 4-7): small pieces only — 1 to 3 squares.
  var EASY_SHAPE_KEYS = [
    'single', 'bar2h', 'bar2v', 'bar3h', 'bar3v',
    'cornerTL', 'cornerTR', 'cornerBL', 'cornerBR'
  ];

  // Medium: the standard full mix.
  var MEDIUM_SHAPE_KEYS = Object.keys(SHAPES);

  var DIFFICULTIES = {
    easy:   { label: 'Easy',   undos: 3, shapeKeys: EASY_SHAPE_KEYS,   hintAlwaysOn: true },
    medium: { label: 'Medium', undos: 1, shapeKeys: MEDIUM_SHAPE_KEYS, hintAlwaysOn: false }
  };

  // Scoring
  var POINTS_PER_CELL_PLACED = 1;   // +1 per square placed on the board
  var POINTS_PER_LINE = 10;         // base points per cleared line
  var COINS_PER_LINE = 1;           // +1 coin per cleared line
  var COINS_PER_COMBO_EXTRA = 1;    // +1 extra coin per combo level beyond 1

  // ------------------------------------------------------------------- state
  var state = null;          // current game state (null until newGame)
  var listeners = [];        // event subscribers
  var history = [];          // undo snapshots (board/tray/score/coins/undos)
  var heldPiece = null;      // piece currently in the Hold slot (or null)
  var holdUsedThisTurn = false;

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      b.push(new Array(BOARD_SIZE).fill(0));
    }
    return b;
  }

  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

  function clonePiece(p) {
    if (!p) return null;
    return { key: p.key, color: p.color, cells: p.cells.map(function (c) { return [c[0], c[1]]; }) };
  }

  // -------------------------------------------------------------- persistence
  function loadInt(key, fallback) {
    try {
      var v = global.localStorage && global.localStorage.getItem(key);
      var n = parseInt(v, 10);
      return isNaN(n) ? fallback : n;
    } catch (e) { return fallback; }
  }

  function saveInt(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, String(value));
    } catch (e) { /* storage unavailable (private mode) — play on without saving */ }
  }

  // ------------------------------------------------------------------- events
  function emit(event) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](event); } catch (e) { /* a bad listener must never break the game */ }
    }
  }

  // ------------------------------------------------------------------ pieces
  function randomPiece(shapeKeys) {
    var key = shapeKeys[Math.floor(Math.random() * shapeKeys.length)];
    var color = COLORS[Math.floor(Math.random() * COLORS.length)];
    return { key: key, color: color, cells: SHAPES[key].map(function (c) { return [c[0], c[1]]; }) };
  }

  function pieceFitsOnBoard(board, piece, row, col) {
    for (var i = 0; i < piece.cells.length; i++) {
      var r = row + piece.cells[i][0];
      var c = col + piece.cells[i][1];
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
      if (board[r][c] !== 0) return false;
    }
    return true;
  }

  function pieceFitsAnywhere(board, piece) {
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (pieceFitsOnBoard(board, piece, r, c)) return true;
      }
    }
    return false;
  }

  // Fair draw: uniform random, never rigged. One kindness only — when a new
  // tray is dealt we re-roll (up to 20 tries) so at least one of the 3 pieces
  // fits the current board. This is NOT rigging for difficulty: it only
  // avoids a cheap instant game-over on an empty-ish board. If the board is
  // genuinely full, no tray can fit and the lose rule still applies.
  function dealTray(shapeKeys, board) {
    var tray;
    for (var attempt = 0; attempt < 20; attempt++) {
      tray = [randomPiece(shapeKeys), randomPiece(shapeKeys), randomPiece(shapeKeys)];
      var anyFits = false;
      for (var i = 0; i < tray.length; i++) {
        if (pieceFitsAnywhere(board, tray[i])) { anyFits = true; break; }
      }
      if (anyFits) return tray;
    }
    return tray; // board is so full nothing fits — the lose rule will fire
  }

  // ------------------------------------------------------------------- clears
  function findFullLines(board) {
    var rows = [], cols = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      var full = true;
      for (var c = 0; c < BOARD_SIZE; c++) { if (board[r][c] === 0) { full = false; break; } }
      if (full) rows.push(r);
    }
    for (var c = 0; c < BOARD_SIZE; c++) {
      var fullC = true;
      for (var r = 0; r < BOARD_SIZE; r++) { if (board[r][c] === 0) { fullC = false; break; } }
      if (fullC) cols.push(c);
    }
    return { rows: rows, cols: cols };
  }

  function clearLines(board, lines) {
    var clearedCells = [];
    lines.rows.forEach(function (r) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== 0) { clearedCells.push({ row: r, col: c }); board[r][c] = 0; }
      }
    });
    lines.cols.forEach(function (c) {
      for (var r = 0; r < BOARD_SIZE; r++) {
        if (board[r][c] !== 0) { clearedCells.push({ row: r, col: c }); board[r][c] = 0; }
      }
    });
    return clearedCells;
  }

  // Lose rule: if NONE of the remaining tray pieces fits anywhere, game over.
  function checkGameOver() {
    var anyFits = false;
    for (var t = 0; t < state.tray.length; t++) {
      if (state.tray[t] && pieceFitsAnywhere(state.board, state.tray[t])) { anyFits = true; break; }
    }
    if (!anyFits) {
      state.over = true;
      var isNewBest = state.score > state.bestScore;
      if (isNewBest) {
        state.bestScore = state.score;
        saveInt(STORE_BEST, state.bestScore);
      }
      saveInt(STORE_GAMES, loadInt(STORE_GAMES, 0) + 1);
      emit({
        type: 'gameover', score: state.score, bestScore: state.bestScore,
        isNewBest: isNewBest, coins: state.coins, linesCleared: state.linesCleared,
        piecesPlaced: state.piecesPlaced, bestCombo: state.bestCombo
      });
    }
    return state.over;
  }

  // RELAX MODE (third/final release): the run never ends. When the tray no
  // longer fits, open space instead of ending the game: clear the fullest
  // row (its cells pop, like a clear), then deal a fresh tray. Clearing ONE
  // full row always leaves 8 adjacent empty cells, so 1-row pieces (single,
  // bars) fit — dealTray's re-roll finds a fitting tray. Up to 3 rows are
  // cleared if needed; if that still fails (essentially impossible), the
  // whole board is cleared. Score / lines / coins keep accumulating — Relax
  // has no game-over screen and no fail state. This is the ONLY place the
  // lose rule is bypassed, and only for Relax runs (the UI calls it only
  // when a Relax game is active). Classic / Adventure / Daily / Weekly are
  // untouched: their gameover event still ends the run.
  function relaxRefresh() {
    if (!state) return { ok: false, reason: 'no-game' };
    if (!state.over) return { ok: false, reason: 'not-over' };
    var shapeKeys = DIFFICULTIES[state.difficulty].shapeKeys;
    var clearedCells = [];
    var rowsCleared = 0;

    function trayFits(tray) {
      for (var i = 0; i < tray.length; i++) {
        if (tray[i] && pieceFitsAnywhere(state.board, tray[i])) return true;
      }
      return false;
    }
    function fullestRow() {
      var bestRow = -1, bestCount = -1;
      for (var r = 0; r < BOARD_SIZE; r++) {
        var n = 0;
        for (var c = 0; c < BOARD_SIZE; c++) if (state.board[r][c] !== 0) n++;
        if (n > bestCount) { bestCount = n; bestRow = r; }
      }
      return { row: bestRow, count: bestCount };
    }
    function clearRow(r) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c] !== 0) { clearedCells.push({ row: r, col: c }); state.board[r][c] = 0; }
      }
    }

    var tray = dealTray(shapeKeys, state.board);
    var attempts = 0;
    while (!trayFits(tray) && attempts < 3) {
      var fr = fullestRow();
      if (fr.count <= 0) break; // board is empty — everything fits (cannot happen here)
      clearRow(fr.row);
      rowsCleared++;
      attempts++;
      tray = dealTray(shapeKeys, state.board);
    }
    if (!trayFits(tray)) {
      // Last resort (never expected): clear the whole board.
      for (var rr = 0; rr < BOARD_SIZE; rr++) clearRow(rr);
      rowsCleared = BOARD_SIZE;
      tray = dealTray(shapeKeys, state.board);
    }
    state.tray = tray;
    state.nextTray = dealTray(shapeKeys, state.board);
    state.over = false;
    // NOTE: no 'tray' event is emitted here on purpose — the UI handles
    // 'relax-refresh' by popping the cleared cells FIRST (380ms), then
    // syncing from engine state, so the refresh is visible. A 'tray'
    // event would sync immediately and hide the pop.
    emit({
      type: 'relax-refresh', cells: clearedCells, rowsCleared: rowsCleared,
      tray: state.tray.map(clonePiece), score: state.score, linesCleared: state.linesCleared
    });
    return { ok: true, clearedCells: clearedCells, rowsCleared: rowsCleared, score: state.score };
  }

  // Tray empty? Deal the next set (the previewed one becomes the tray).
  function refillTrayIfEmpty() {
    var trayEmpty = state.tray.every(function (p) { return p === null; });
    if (trayEmpty) {
      state.tray = state.nextTray;
      state.nextTray = dealTray(DIFFICULTIES[state.difficulty].shapeKeys, state.board);
      emit({ type: 'tray', tray: state.tray.map(clonePiece), nextTray: state.nextTray.map(clonePiece) });
    }
  }
  function pushHistory() {
    history.push({
      board: cloneBoard(state.board),
      tray: state.tray.map(clonePiece),
      nextTray: state.nextTray.map(clonePiece),
      heldPiece: clonePiece(heldPiece),
      holdUsedThisTurn: holdUsedThisTurn,
      score: state.score,
      coins: state.coins,
      undosLeft: state.undosLeft,
      linesCleared: state.linesCleared,
      piecesPlaced: state.piecesPlaced
    });
    if (history.length > 50) history.shift(); // cap memory
  }

  // ---------------------------------------------------------------------- API
  function newGame(difficulty) {
    if (!DIFFICULTIES[difficulty]) difficulty = 'easy';
    var cfg = DIFFICULTIES[difficulty];
    var board = emptyBoard();
    state = {
      mode: 'classic',
      difficulty: difficulty,
      board: board,
      tray: dealTray(cfg.shapeKeys, board),
      nextTray: dealTray(cfg.shapeKeys, board), // preview: the set after this tray
      score: 0,
      bestScore: loadInt(STORE_BEST, 0),
      coins: loadInt(STORE_COINS, 0),
      undosLeft: cfg.undos,
      undosTotal: cfg.undos,
      linesCleared: 0,
      piecesPlaced: 0,
      combos: 0,
      bestCombo: 0,
      over: false,
      moves: 0
    };
    history = [];
    heldPiece = null;
    holdUsedThisTurn = false;
    emit({ type: 'newgame', difficulty: difficulty, state: getState() });
    emit({ type: 'tray', tray: state.tray.map(clonePiece), nextTray: state.nextTray.map(clonePiece) });
    return getState();
  }

  function canPlace(pieceIndex, row, col) {
    if (!state || state.over) return false;
    var piece = state.tray[pieceIndex];
    if (!piece) return false;
    return pieceFitsOnBoard(state.board, piece, row, col);
  }

  function findFits(pieceIndex) {
    if (!state || state.over) return [];
    var piece = state.tray[pieceIndex];
    if (!piece) return [];
    var spots = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (pieceFitsOnBoard(state.board, piece, r, c)) spots.push({ row: r, col: c });
      }
    }
    return spots;
  }

  function placePiece(pieceIndex, row, col) {
    if (!state) return { ok: false, reason: 'no-game' };
    if (state.over) return { ok: false, reason: 'game-over' };
    var piece = state.tray[pieceIndex];
    if (!piece) return { ok: false, reason: 'no-piece' };
    if (!pieceFitsOnBoard(state.board, piece, row, col)) {
      return { ok: false, reason: 'no-fit' }; // bounces back — UI shows it
    }

    pushHistory();

    // Land the piece (store colour index+1 so 0 stays "empty").
    var colorIndex = COLORS.indexOf(piece.color) + 1;
    for (var i = 0; i < piece.cells.length; i++) {
      state.board[row + piece.cells[i][0]][col + piece.cells[i][1]] = colorIndex;
    }
    state.tray[pieceIndex] = null;
    state.piecesPlaced++;
    state.moves++;
    state.score += piece.cells.length * POINTS_PER_CELL_PLACED;
    holdUsedThisTurn = false; // a placement opens the Hold slot again

    emit({
      type: 'place', piece: clonePiece(piece), row: row, col: col,
      cellsPlaced: piece.cells.length, score: state.score
    });

    // Clear full rows / columns.
    var lines = findFullLines(state.board);
    var lineCount = lines.rows.length + lines.cols.length;
    var clearedCells = [];
    var combo = 0;
    var clearPoints = 0;
    var coinsEarned = 0;
    if (lineCount > 0) {
      clearedCells = clearLines(state.board, lines);
      combo = lineCount > 1 ? lineCount : 1; // 2+ lines at once = combo x2, x3...
      clearPoints = POINTS_PER_LINE * lineCount * combo;
      coinsEarned = COINS_PER_LINE * lineCount + (combo > 1 ? (combo - 1) * COINS_PER_COMBO_EXTRA : 0);
      state.score += clearPoints;
      state.coins += coinsEarned;
      state.linesCleared += lineCount;
      if (combo > 1) {
        state.combos++;
        if (combo > state.bestCombo) state.bestCombo = combo;
      }
      saveInt(STORE_COINS, state.coins);
      emit({
        type: 'clear', cells: clearedCells, lines: lineCount, combo: combo,
        points: clearPoints, coinsEarned: coinsEarned, score: state.score,
        coins: state.coins
      });
    }

    // Tray empty? Deal the next set (the previewed one becomes the tray).
    refillTrayIfEmpty();

    // Lose rule: if NONE of the remaining tray pieces fits anywhere, game over.
    checkGameOver();

    return {
      ok: true, placed: true, clearedCells: clearedCells, lines: lineCount,
      combo: combo, points: clearPoints, coinsEarned: coinsEarned,
      score: state.score, coins: state.coins, over: state.over
    };
  }

  function undo() {
    if (!state) return { ok: false, reason: 'no-game' };
    if (state.undosLeft <= 0) return { ok: false, reason: 'no-undos-left' };
    if (history.length === 0) return { ok: false, reason: 'nothing-to-undo' };
    if (state.over) return { ok: false, reason: 'game-over' };
    var snap = history.pop();
    state.board = snap.board;
    state.tray = snap.tray;
    state.nextTray = snap.nextTray;
    heldPiece = snap.heldPiece;
    holdUsedThisTurn = snap.holdUsedThisTurn;
    state.score = snap.score;
    state.coins = snap.coins;
    state.linesCleared = snap.linesCleared;
    state.piecesPlaced = snap.piecesPlaced;
    // Undo costs one from the CURRENT count — never restore the snapshot's
    // count, or a second undo would refund the first one.
    state.undosLeft = state.undosLeft - 1;
    saveInt(STORE_COINS, state.coins);
    emit({ type: 'undo', undosLeft: state.undosLeft, score: state.score });
    return { ok: true, undosLeft: state.undosLeft, score: state.score };
  }

  // Hold: swap the chosen tray piece with the held piece. One swap per turn
  // (a placement resets the slot). Free, no purchases.
  function hold(pieceIndex) {
    if (!state) return { ok: false, reason: 'no-game' };
    if (state.over) return { ok: false, reason: 'game-over' };
    if (holdUsedThisTurn) return { ok: false, reason: 'hold-used' };
    var piece = state.tray[pieceIndex];
    if (!piece) return { ok: false, reason: 'no-piece' };
    pushHistory();
    state.tray[pieceIndex] = heldPiece;
    heldPiece = piece;
    holdUsedThisTurn = true;
    // Edge case: holding the last tray piece empties the tray — deal the
    // next set immediately so the player is never stuck with no piece.
    refillTrayIfEmpty();
    checkGameOver();
    emit({ type: 'hold', held: clonePiece(heldPiece), tray: state.tray.map(clonePiece) });
    return { ok: true, held: clonePiece(heldPiece) };
  }

  // Hint: first valid placement found, tray order then top-left scan.
  // Easy: always on (the UI may auto-show it). Medium: on demand.
  function hint() {
    if (!state || state.over) return null;
    for (var i = 0; i < state.tray.length; i++) {
      var piece = state.tray[i];
      if (!piece) continue;
      var spots = findFits(i);
      if (spots.length > 0) {
        var h = { pieceIndex: i, row: spots[0].row, col: spots[0].col, piece: clonePiece(piece) };
        emit({ type: 'hint', hint: h });
        return h;
      }
    }
    return null; // no placement exists — game over is about to fire anyway
  }

  function getState() {
    if (!state) return null;
    return {
      mode: state.mode,
      difficulty: state.difficulty,
      board: cloneBoard(state.board),
      tray: state.tray.map(clonePiece),
      nextTray: state.nextTray.map(clonePiece),
      heldPiece: clonePiece(heldPiece),
      holdAvailable: !holdUsedThisTurn,
      score: state.score,
      bestScore: state.bestScore,
      coins: state.coins,
      undosLeft: state.undosLeft,
      undosTotal: state.undosTotal,
      linesCleared: state.linesCleared,
      piecesPlaced: state.piecesPlaced,
      combos: state.combos,
      bestCombo: state.bestCombo,
      over: state.over,
      moves: state.moves,
      hintAlwaysOn: DIFFICULTIES[state.difficulty].hintAlwaysOn
    };
  }

  function onEvent(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function off() {
      var i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  // ------------------------------------------------------- drag helper (optional)
  // A small pointer-events drag controller for Agent 2's UI. It does NOT
  // render anything — it only translates pointer drags on tray piece elements
  // into canPlace/placePiece calls, with a live "ghost" callback so the UI
  // can draw the dragged piece and its landing highlight.
  // opts: {
  //   boardEl: element containing the 8x8 board cells (children in row-major
  //            order, each with data-row / data-col),
  //   traySelector: CSS selector for tray piece elements (each with
  //            data-piece-index), searched inside opts.trayEl (or document),
  //   onGhost(pieceIndex, row, col, canPlace) — called on every move while
  //            dragging (row/col null when not over the board),
  //   onDrop(result) — called after a drop attempt
  // }
  // Returns { destroy() }.
  function createDragController(opts) {
    opts = opts || {};
    var boardEl = opts.boardEl;
    var trayRoot = opts.trayEl || (typeof document !== 'undefined' ? document : null);
    var onGhost = opts.onGhost || function () {};
    var onDrop = opts.onDrop || function () {};

    var drag = null; // { pieceIndex, pointerId }

    function cellFromPoint(x, y) {
      if (!boardEl || !boardEl.getBoundingClientRect) return null;
      var rect = boardEl.getBoundingClientRect();
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
      var cellW = rect.width / BOARD_SIZE;
      var cellH = rect.height / BOARD_SIZE;
      var col = Math.floor((x - rect.left) / cellW);
      var row = Math.floor((y - rect.top) / cellH);
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
      return { row: row, col: col };
    }

    function onPointerDown(e) {
      if (!state || state.over) return;
      var idx = e.currentTarget.getAttribute('data-piece-index');
      idx = idx === null ? -1 : parseInt(idx, 10);
      if (idx < 0 || !state.tray[idx]) return;
      drag = { pieceIndex: idx, pointerId: e.pointerId };
      if (e.currentTarget.setPointerCapture) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      }
      onGhost(idx, null, null, false);
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var cell = cellFromPoint(e.clientX, e.clientY);
      if (!cell) { onGhost(drag.pieceIndex, null, null, false); return; }
      onGhost(drag.pieceIndex, cell.row, cell.col, canPlace(drag.pieceIndex, cell.row, cell.col));
    }

    function onPointerUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var idx = drag.pieceIndex;
      drag = null;
      var cell = cellFromPoint(e.clientX, e.clientY);
      var result;
      if (cell && canPlace(idx, cell.row, cell.col)) {
        result = placePiece(idx, cell.row, cell.col);
      } else {
        // Bounce back — invalid spot or dropped outside the board.
        result = { ok: false, reason: cell ? 'no-fit' : 'outside-board' };
      }
      onGhost(idx, null, null, false);
      onDrop(result);
    }

    function onPointerCancel(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var idx = drag.pieceIndex;
      drag = null;
      onGhost(idx, null, null, false);
    }

    var pieces = [];
    if (trayRoot && trayRoot.querySelectorAll) {
      var nodes = trayRoot.querySelectorAll(opts.traySelector || '[data-piece-index]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerCancel);
        pieces.push(el);
      }
    }

    return {
      destroy: function () {
        pieces.forEach(function (el) {
          el.removeEventListener('pointerdown', onPointerDown);
          el.removeEventListener('pointermove', onPointerMove);
          el.removeEventListener('pointerup', onPointerUp);
          el.removeEventListener('pointercancel', onPointerCancel);
        });
        drag = null;
      },
      // Re-scan the tray (call after the UI re-renders tray pieces).
      refresh: function () {
        this.destroy();
        return createDragController(opts);
      }
    };
  }

  // Set the coin counter. Additive API for the challenges module: reward
  // coins are banked into the engine's own counter so later syncs (which
  // read engine state) cannot wipe them. No game rule changes.
  function setCoins(v) {
    if (!state) return { ok: false, reason: 'no-game' };
    state.coins = Math.max(0, Math.floor(v) || 0);
    saveInt(STORE_COINS, state.coins);
    return { ok: true, coins: state.coins };
  }

  // ------------------------------------------------------------------ export
  var api = {
    newGame: newGame,
    canPlace: canPlace,
    findFits: findFits,
    placePiece: placePiece,
    undo: undo,
    hold: hold,
    hint: hint,
    relaxRefresh: relaxRefresh,
    setCoins: setCoins,
    getState: getState,
    onEvent: onEvent,
    createDragController: createDragController,
    SHAPES: SHAPES,
    COLORS: COLORS,
    DIFFICULTIES: DIFFICULTIES,
    BOARD_SIZE: BOARD_SIZE,
    TRAY_SIZE: TRAY_SIZE,
    VERSION: '1.0.0-classic'
  };

  global.MiloPop = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);

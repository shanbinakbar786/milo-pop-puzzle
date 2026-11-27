/* Milo Pop Puzzle — Adventure levels (second release).
   500 levels, code-generated (no hand-written level data):
   Easy 250 (5 worlds x 50) + Medium 250 (5 worlds x 50).
   Goal types alternate: score goals (reach X points) and lines goals
   (clear X lines). 1-3 stars per level from score thresholds; 1,500 max.

   Goal calibration (measured 27 Nov 2026 with a greedy player vs the real
   engine, 300 games per difficulty):
   - Medium greedy: score p25=89 p40=125 p50=141 p65=164 p85=237;
     lines p40=5 p50=6 p85=11. Medium goals grow 55 -> ~195.
   - Easy greedy is nearly unlosable (tiny 1-3-cell pieces), ~5.8 pts/move,
     ~0.31 lines/move, so Easy goals are move-budget based: score 60 -> 360,
     lines 3 -> 10. Early levels are deliberately easy (teaching).
   Stars: 1 star = goal reached; 2/3 stars = higher score thresholds.

   Pre-placed starting blocks (Adventure only, 27 Nov 2026 — Block Blast
   Adventure style; Classic always starts completely empty, unchanged):
   - Deterministic: the layout is seeded from the level key, so the same
     level always shows the same starting blocks.
   - Scale: target filled cells grow with world; Medium starts with a few
     more than Easy at the same world; never more than ~1/3 of the board.
     Easy:   W1 4, W2 7, W3 10, W4 13, W5 16  (+/-1 jitter per level)
     Medium: W1 7, W2 10, W3 13, W4 16, W5 19 (+/-1 jitter per level)
   - Shapes: real piece shapes (single, bars, corners, 2x2 square) placed
     on empty cells with a random jewel colour; they render exactly like
     normally placed blocks — no special marking.
   - Layout: the blocks grow as ONE connected cluster (each new shape
     touches the blocks already placed), like Block Blast Adventure
     patterns — a compact blob, not scattered shards. Scattered singles
     fragment the board and make Medium's big pieces (5-bars, 3x3, big L)
     nearly unplaceable: measured 27 Nov 2026, scattered layout cut the
     Medium greedy win rate to 20% in World 5 (66% unseeded). Clustering
     keeps large open areas so big pieces still fit.
   - Safety: a placement that would complete a full row/column is rejected
     (no free instant clear at level start); after generation we verify
     that pieces from the difficulty's shape set can still be placed, and
     re-seed (different attempt) if not. A level can never start lost.
   Seeded-board calibration (greedy bot vs the real engine, 27 Nov 2026):
   - Scattered layout (first try) cut Medium badly: greedy median score
     p50 104 vs 186 unseeded, W5 win rate 20% (66% unseeded) — scattered
     singles fragment the board for Medium's big pieces.
   - Clustered layout (one connected blob): Medium p50 128 vs 194
     unseeded; win rates W1 88% / W2 66% / W3 42% / W4 34% / W5 26%.
     Still too hard late, so Medium goals were recalibrated (see the
     goal formulas below): score goals x0.65 (35 -> 125) and lines goals
     slowed /30 -> /45 (3 -> 8). Re-measured with the new goals
     (greedy bot, 250 levels/difficulty): Medium win W1 94% / W2 86% /
     W3 68% / W4 54% / W5 56% — a healthy curve, ~95% early to ~55%
     late for the bot. Easy re-measured 98-100% every world.
   - Easy barely moved (seeded win 96-100% every world), so Easy goals
     are UNCHANGED.

   Unlock rule (documented, simplest): levels unlock in order. Level 1 of
   each difficulty is always open; a level unlocks when the previous level
   earned >= 1 star. A world unlocks when its first level unlocks (i.e. the
   previous world's level 50 is done). Progress persists in localStorage
   ("mpp_adv_v1"); no sign-in, no account, no server. */
(function () {
  "use strict";

  var WORLDS_PER_DIFF = 5;
  var LEVELS_PER_WORLD = 50;
  var TOTAL_PER_DIFF = WORLDS_PER_DIFF * LEVELS_PER_WORLD; // 250
  var MAX_STARS = TOTAL_PER_DIFF * 2 * 3; // 1500
  var STORE_KEY = "mpp_adv_v1";

  var WORLDS = [
    { id: 1, key: "world1", emoji: "\uD83C\uDF3C", theme: "meadow" },
    { id: 2, key: "world2", emoji: "\uD83C\uDF6C", theme: "candy" },
    { id: 3, key: "world3", emoji: "\uD83C\uDF0A", theme: "ocean" },
    { id: 4, key: "world4", emoji: "\uD83C\uDF1F", theme: "night" },
    { id: 5, key: "world5", emoji: "\uD83D\uDC51", theme: "gold" }
  ];

  function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }

  /* Deterministic PRNG: FNV-1a hash of the level key -> mulberry32. */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Small shapes used for seeded layouts (subset of the engine's shapes). */
  var SEED_SHAPES = [
    { key: "single", cells: [[0, 0]] },
    { key: "bar2h", cells: [[0, 0], [0, 1]] },
    { key: "bar2v", cells: [[0, 0], [1, 0]] },
    { key: "bar3h", cells: [[0, 0], [0, 1], [0, 2]] },
    { key: "bar3v", cells: [[0, 0], [1, 0], [2, 0]] },
    { key: "cornerTL", cells: [[0, 0], [0, 1], [1, 0]] },
    { key: "cornerTR", cells: [[0, 0], [0, 1], [1, 1]] },
    { key: "cornerBL", cells: [[0, 0], [1, 0], [1, 1]] },
    { key: "cornerBR", cells: [[0, 1], [1, 0], [1, 1]] },
    { key: "square2", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] }
  ];

  /* Full engine shape table (mirror of game.js SHAPES — kept in sync and
     cross-checked by test-levels.js). Used only for the solvability check:
     do pieces from this difficulty's set still fit the seeded board? */
  var FULL_SHAPES = {
    single: [[0, 0]],
    bar2h: [[0, 0], [0, 1]], bar2v: [[0, 0], [1, 0]],
    bar3h: [[0, 0], [0, 1], [0, 2]], bar3v: [[0, 0], [1, 0], [2, 0]],
    bar5h: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    bar5v: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
    square2: [[0, 0], [0, 1], [1, 0], [1, 1]],
    square3: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
    cornerTL: [[0, 0], [0, 1], [1, 0]], cornerTR: [[0, 0], [0, 1], [1, 1]],
    cornerBL: [[0, 0], [1, 0], [1, 1]], cornerBR: [[0, 1], [1, 0], [1, 1]],
    bigL1: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
    bigL2: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]],
    bigL3: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    bigL4: [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]],
    tDown: [[0, 0], [0, 1], [0, 2], [1, 1]], tUp: [[0, 1], [1, 0], [1, 1], [1, 2]],
    tRight: [[0, 0], [1, 0], [1, 1], [2, 0]], tLeft: [[0, 1], [1, 0], [1, 1], [2, 1]],
    zigH1: [[0, 0], [0, 1], [1, 1], [1, 2]], zigH2: [[0, 1], [0, 2], [1, 0], [1, 1]],
    zigV1: [[0, 0], [1, 0], [1, 1], [2, 1]], zigV2: [[0, 1], [1, 0], [1, 1], [2, 0]],
    plus: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
    uUp: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
    uDown: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]],
    uLeft: [[0, 0], [0, 1], [1, 1], [2, 0], [2, 1]],
    uRight: [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]]
  };
  var EASY_SHAPE_KEYS = ["single", "bar2h", "bar2v", "bar3h", "bar3v",
    "cornerTL", "cornerTR", "cornerBL", "cornerBR"];
  var MEDIUM_SHAPE_KEYS = Object.keys(FULL_SHAPES);

  function seedTargetCells(diff, world) {
    var base = [0, 4, 7, 10, 13, 16][Math.max(1, Math.min(5, world | 0))];
    if (diff === "medium") base += 3;
    return base;
  }

  function shapeFitsOnBoard(board, cells, row, col) {
    for (var i = 0; i < cells.length; i++) {
      var r = row + cells[i][0], c = col + cells[i][1];
      if (r < 0 || r >= 8 || c < 0 || c >= 8) return false;
      if (board[r][c] !== 0) return false;
    }
    return true;
  }

  function boardHasFullLine(board) {
    for (var r = 0; r < 8; r++) {
      var full = true;
      for (var c = 0; c < 8; c++) { if (board[r][c] === 0) { full = false; break; } }
      if (full) return true;
    }
    for (var c = 0; c < 8; c++) {
      var fullC = true;
      for (var r = 0; r < 8; r++) { if (board[r][c] === 0) { fullC = false; break; } }
      if (fullC) return true;
    }
    return false;
  }

  /* Count distinct (shape, position) placements that fit — the solvability
     margin. A seeded board is accepted only when plenty of placements fit. */
  function countFittingPlacements(board, shapeKeys) {
    var n = 0;
    for (var s = 0; s < shapeKeys.length; s++) {
      var cells = FULL_SHAPES[shapeKeys[s]];
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          if (shapeFitsOnBoard(board, cells, r, c)) n++;
        }
      }
    }
    return n;
  }

  /* Is any cell of a shape (placed at row,col) 4-adjacent to a filled cell? */
  function touchesCluster(board, cells, row, col) {
    for (var i = 0; i < cells.length; i++) {
      var r = row + cells[i][0], c = col + cells[i][1];
      if (board[r - 1] && board[r - 1][c]) return true;
      if (board[r + 1] && board[r + 1][c]) return true;
      if (board[r][c - 1]) return true;
      if (board[r][c + 1]) return true;
    }
    return false;
  }

  /* Deterministic starting board for an Adventure level: an 8x8 array of
     colour indices (0 = empty, 1..6 = jewel colours), exactly like the
     engine's board format. Pure function — same def always gives the same
     board. attempt is internal (re-seed on a failed solvability check). */
  function seedBoard(def, attempt) {
    attempt = attempt | 0;
    var rng = mulberry32(fnv1a(def.key + "#" + attempt));
    var target = seedTargetCells(def.diff, def.world) + (Math.floor(rng() * 3) - 1);
    target = Math.max(3, Math.min(20, target));
    var board = [];
    for (var r = 0; r < 8; r++) board.push([0, 0, 0, 0, 0, 0, 0, 0]);
    var placed = 0, tries = 0;
    while (placed < target && tries < 400) {
      tries++;
      var remaining = target - placed;
      var cands = [];
      for (var i = 0; i < SEED_SHAPES.length; i++) {
        if (SEED_SHAPES[i].cells.length <= remaining) cands.push(SEED_SHAPES[i]);
      }
      if (cands.length === 0) break;
      var shape = cands[Math.floor(rng() * cands.length)];
      var maxR = 0, maxC = 0;
      shape.cells.forEach(function (cc) { maxR = Math.max(maxR, cc[0]); maxC = Math.max(maxC, cc[1]); });
      var row = Math.floor(rng() * (8 - maxR));
      var col = Math.floor(rng() * (8 - maxC));
      if (!shapeFitsOnBoard(board, shape.cells, row, col)) continue;
      /* After the first shape, grow ONE connected cluster: the new shape
         must touch the blocks already placed. (A scattered layout
         fragments the board for Medium's big pieces.) */
      if (placed > 0 && !touchesCluster(board, shape.cells, row, col)) continue;
      var color = 1 + Math.floor(rng() * 6);
      shape.cells.forEach(function (cc) { board[row + cc[0]][col + cc[1]] = color; });
      if (boardHasFullLine(board)) {
        // Never start with a free instant clear — revert this placement.
        shape.cells.forEach(function (cc) { board[row + cc[0]][col + cc[1]] = 0; });
        continue;
      }
      placed += shape.cells.length;
    }
    // Guarantee a minimum: top up with single cells if the loop stalled.
    // Singles also join the cluster (or go anywhere when the board is empty).
    var guard = 0;
    while (placed < 3 && guard++ < 100) {
      var rr = Math.floor(rng() * 8), cc = Math.floor(rng() * 8);
      if (board[rr][cc] !== 0) continue;
      if (placed > 0 && !touchesCluster(board, [[0, 0]], rr, cc)) continue;
      board[rr][cc] = 1 + Math.floor(rng() * 6);
      if (boardHasFullLine(board)) { board[rr][cc] = 0; continue; }
      placed++;
    }
    // Solvability: plenty of placements from this difficulty's set must fit.
    var keys = def.diff === "medium" ? MEDIUM_SHAPE_KEYS : EASY_SHAPE_KEYS;
    if (countFittingPlacements(board, keys) < 20 && attempt < 50) {
      return seedBoard(def, attempt + 1);
    }
    return board;
  }


  /* Deterministic level definition — same input always gives the same level. */
  function levelDef(diff, world, num) {
    if (diff !== "easy" && diff !== "medium") diff = "easy";
    world = Math.max(1, Math.min(WORLDS_PER_DIFF, world | 0));
    num = Math.max(1, Math.min(LEVELS_PER_WORLD, num | 0));
    var g = (world - 1) * LEVELS_PER_WORLD + num; // 1..250
    var isLines = (num % 3 === 0); // every 3rd level is a lines goal
    var def = {
      key: diff + "-" + world + "-" + num,
      diff: diff, world: world, num: num, g: g,
      goalType: isLines ? "lines" : "score",
      goal: 0, star2: 0, star3: 0
    };
    if (diff === "easy") {
      if (isLines) {
        def.goal = 3 + Math.floor((g - 1) / 35); // 3..10 lines
        def.star2 = def.goal * 25;
        def.star3 = def.goal * 40;
      } else {
        def.goal = round5(60 + g * 1.2); // 60 -> 360 points
        def.star2 = round5(def.goal * 1.6);
        def.star3 = round5(def.goal * 2.4);
      }
    } else {
      if (isLines) {
        def.goal = 3 + Math.floor((g - 1) / 45); // 3..8 lines (slowed 27 Nov
        // 2026: seeded boards cut Medium line clears ~40%, so lines goals
        // grow slower than the original /30 — W5 tops out at 8, not 11)
        def.star2 = def.goal * 25;
        def.star3 = def.goal * 40;
      } else {
        def.goal = round5((55 + g * 0.55) * 0.65); // 35 -> 125 points
        // (scaled x0.65 on 27 Nov 2026: seeded boards cut Medium greedy
        // median scores ~34% — clustered layout p50 128 vs 194 unseeded —
        // so goals were unreachable in late worlds: W5 greedy win 26%.
        // x0.65 restores a healthy curve, ~95% W1 -> ~55% W5 for the bot.)
        def.star2 = round5(def.goal * 1.4);
        def.star3 = round5(def.goal * 2.0);
      }
    }
    return def;
  }

  function parseKey(key) {
    var m = /^(easy|medium)-(\d)-(\d+)$/.exec(String(key || ""));
    if (!m) return null;
    return levelDef(m[1], parseInt(m[2], 10), parseInt(m[3], 10));
  }

  /* Stars earned for a finished level. 0 = goal not reached. */
  function starsFor(def, score, lines) {
    score = score || 0; lines = lines || 0;
    var reached = def.goalType === "lines" ? lines >= def.goal : score >= def.goal;
    if (!reached) return 0;
    if (score >= def.star3) return 3;
    if (score >= def.star2) return 2;
    return 1;
  }

  /* ---------- progress (localStorage, in-memory fallback) ---------- */
  var memData = null;
  function hasStorage() { try { return typeof localStorage !== "undefined" && !!localStorage.getItem; } catch (e) { return false; } }
  function loadData() {
    if (memData) return memData;
    var d = { v: 1, prog: {} };
    if (hasStorage()) {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) { var p = JSON.parse(raw); if (p && p.prog) d = p; }
      } catch (e) { /* corrupt save — start fresh */ }
    }
    memData = d;
    return d;
  }
  function saveData() {
    if (!memData) return;
    if (hasStorage()) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(memData)); } catch (e) { /* private mode */ }
    }
  }
  function resetData() { memData = { v: 1, prog: {} }; saveData(); }

  function getProgress(key) {
    var d = loadData();
    var p = d.prog[key];
    return p ? { stars: p.s || 0, best: p.b || 0 } : { stars: 0, best: 0 };
  }

  /* Record a level result. Keeps the best stars and best score.
     Returns { stars, best, isNewBest, isFirstClear }. */
  function recordResult(key, stars, score) {
    var d = loadData();
    var prev = d.prog[key] || { s: 0, b: 0 };
    var isFirstClear = prev.s === 0 && stars >= 1;
    var isNewBest = score > (prev.b || 0);
    d.prog[key] = { s: Math.max(prev.s || 0, stars), b: Math.max(prev.b || 0, score) };
    memData = d;
    saveData();
    return { stars: d.prog[key].s, best: d.prog[key].b, isNewBest: isNewBest, isFirstClear: isFirstClear };
  }

  function seqOf(def) { return (def.world - 1) * LEVELS_PER_WORLD + (def.num - 1); }
  function defOfSeq(diff, seq) {
    return levelDef(diff, Math.floor(seq / LEVELS_PER_WORLD) + 1, (seq % LEVELS_PER_WORLD) + 1);
  }

  function isUnlocked(def) {
    var seq = seqOf(def);
    if (seq === 0) return true;
    var prev = defOfSeq(def.diff, seq - 1);
    return getProgress(prev.key).stars >= 1;
  }

  function totalStars(diff) {
    var n = 0;
    var d = loadData();
    var prefix = diff ? diff + "-" : "";
    Object.keys(d.prog).forEach(function (k) {
      if (k.indexOf(prefix) === 0) n += (d.prog[k].s || 0);
    });
    return n;
  }

  function worldStars(diff, world) {
    var n = 0;
    var d = loadData();
    var prefix = diff + "-" + world + "-";
    Object.keys(d.prog).forEach(function (k) {
      if (k.indexOf(prefix) === 0) n += (d.prog[k].s || 0);
    });
    return n;
  }

  /* First level in this difficulty that is unlocked but not yet cleared (1+ stars).
     Returns the level def, or null when all 250 are cleared. */
  function firstUnfinished(diff) {
    for (var seq = 0; seq < TOTAL_PER_DIFF; seq++) {
      var def = defOfSeq(diff, seq);
      if (getProgress(def.key).stars < 1) return def;
    }
    return null;
  }

  function allLevels(diff) {
    var out = [];
    for (var seq = 0; seq < TOTAL_PER_DIFF; seq++) out.push(defOfSeq(diff, seq));
    return out;
  }

  var api = {
    WORLDS: WORLDS,
    WORLDS_PER_DIFF: WORLDS_PER_DIFF,
    LEVELS_PER_WORLD: LEVELS_PER_WORLD,
    TOTAL_PER_DIFF: TOTAL_PER_DIFF,
    MAX_STARS: MAX_STARS,
    levelDef: levelDef,
    parseKey: parseKey,
    starsFor: starsFor,
    seedBoard: seedBoard,
    seedTargetCells: seedTargetCells,
    SHAPES: FULL_SHAPES,
    getProgress: getProgress,
    recordResult: recordResult,
    isUnlocked: isUnlocked,
    totalStars: totalStars,
    worldStars: worldStars,
    firstUnfinished: firstUnfinished,
    allLevels: allLevels,
    _reset: resetData
  };

  if (typeof window !== "undefined") window.MiloAdventure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

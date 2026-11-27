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
        def.goal = 3 + Math.floor((g - 1) / 30); // 3..11 lines
        def.star2 = def.goal * 25;
        def.star3 = def.goal * 40;
      } else {
        def.goal = round5(55 + g * 0.55); // 55 -> 195 points
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

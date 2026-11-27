/* Milo Pop Puzzle — Daily Challenge + Weekly Challenge + Missions.
   Third release. Built on the unchanged engine (game.js): a challenge is a
   Classic game with a goal, exactly like an Adventure level. Missions hook
   into the engine's events — this module never changes game.js.

   DAILY: one puzzle per calendar day, seeded by the date so every player
   gets the SAME puzzle that day (same difficulty + goal). Playing it
   advances the STREAK (consecutive days played). Rewards: win = +50 coins;
   7-day streak unlocks the Golden Theme; 30-day streak unlocks the Star Skin.
   WEEKLY: a new challenge every Monday (seeded by the week's Monday date).
   Winning it earns a BADGE (+100 coins). Badges persist per week.
   MISSIONS (5, from the locked spec): clear 5 lines in one game / make a
   3x combo / score 1000 in one game / play 7 days in a row / clear 50
   lines total. Each shows progress and pays coins when completed.
   Coins earned here are banked as "pending" and flushed into the game's
   coin counter only when a run ENDS (game over / level result / quit) —
   that is the only safe moment, because the engine owns the coin counter
   while a game is running and overwrites it on every event.

   Progress persists in localStorage ("mpp_chal_v1"); no sign-in, no
   account, no server. No timer, no lives, no Hard/Expert anywhere. */
(function () {
  "use strict";

  var STORE_KEY = "mpp_chal_v1";
  var ENGINE_COINS_KEY = "milo-pop-coins"; /* game.js store — the source of truth */
  var UI_COINS_KEY = "mpp_coins";

  var DAILY_WIN_COINS = 50;
  var WEEKLY_WIN_COINS = 100;

  var MISSIONS = [
    { id: "lines5",    target: 5,    reward: 30,  icon: "🧹", titleKey: "mLines5",    descKey: "mLines5Desc" },
    { id: "combo3",    target: 3,    reward: 50,  icon: "💥", titleKey: "mCombo3",    descKey: "mCombo3Desc" },
    { id: "score1000", target: 1000, reward: 100, icon: "🏆", titleKey: "mScore1000", descKey: "mScore1000Desc" },
    { id: "streak7",   target: 7,    reward: 100, icon: "🔥", titleKey: "mStreak7",   descKey: "mStreak7Desc" },
    { id: "lines50",   target: 50,   reward: 75,  icon: "💪", titleKey: "mLines50",   descKey: "mLines50Desc" }
  ];

  /* ---------------- date helpers (LOCAL dates — the player's day) ---------------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function keyToDate(key) {
    var p = String(key || "").split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  function addDays(key, n) {
    var d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  /* Monday of the week containing this date (local). */
  function weekKey(d) {
    d = d || new Date();
    var day = d.getDay(); /* 0 Sun .. 6 Sat */
    var diff = (day + 6) % 7; /* days since Monday */
    var m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
    return dateKey(m);
  }
  function prettyDate(key) {
    var d = keyToDate(key);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  /* ---------------- deterministic seed (FNV-1a + mulberry32) ---------------- */
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }

  /* Star thresholds, same shape as Adventure levels: 1 = goal reached,
     2/3 = higher score thresholds. */
  function starThresholds(def) {
    if (def.goalType === "lines") {
      def.star2 = def.goal * 25;
      def.star3 = def.goal * 40;
    } else {
      def.star2 = round5(def.goal * 1.4);
      def.star3 = round5(def.goal * 2.0);
    }
    return def;
  }
  function starsFor(def, score, lines) {
    score = score || 0; lines = lines || 0;
    var reached = def.goalType === "lines" ? lines >= def.goal : score >= def.goal;
    if (!reached) return 0;
    if (score >= def.star3) return 3;
    if (score >= def.star2) return 2;
    return 1;
  }

  /* ---------------- challenge definitions (seeded, same for everyone) ---------------- */
  function dailyDef(date) {
    var key = dateKey(date);
    var rng = mulberry32(hashStr("daily-" + key));
    var difficulty = rng() < 0.5 ? "easy" : "medium";
    var goalType = rng() < 0.6 ? "score" : "lines";
    var goal;
    if (goalType === "score") {
      goal = difficulty === "easy"
        ? 100 + Math.floor(rng() * 13) * 10   /* 100..220 */
        : 120 + Math.floor(rng() * 9) * 10;   /* 120..200 */
    } else {
      goal = 5 + Math.floor(rng() * 4);       /* 5..8 lines */
    }
    return starThresholds({
      kind: "daily", key: key, date: key,
      difficulty: difficulty, goalType: goalType, goal: goal,
      reward: DAILY_WIN_COINS
    });
  }

  function weeklyDef(date) {
    var key = weekKey(date);
    var rng = mulberry32(hashStr("weekly-" + key));
    var difficulty = rng() < 0.7 ? "medium" : "easy";
    var goalType = rng() < 0.6 ? "score" : "lines";
    var goal;
    if (goalType === "score") {
      goal = difficulty === "easy"
        ? 250 + Math.floor(rng() * 11) * 10   /* 250..350 */
        : 300 + Math.floor(rng() * 11) * 10;  /* 300..400 */
    } else {
      goal = 10 + Math.floor(rng() * 5);      /* 10..14 lines */
    }
    return starThresholds({
      kind: "weekly", key: key, weekStart: key,
      difficulty: difficulty, goalType: goalType, goal: goal,
      reward: WEEKLY_WIN_COINS
    });
  }

  /* ---------------- persistence ---------------- */
  var memData = null;
  function hasStorage() { try { return typeof localStorage !== "undefined" && !!localStorage.getItem; } catch (e) { return false; } }
  function blank() {
    return {
      v: 1,
      daily: { lastPlayed: "", streak: 0, played: {}, best: {} },
      weekly: { badges: [], best: {} },
      missions: {},           /* id -> { done: true } (progress lives in totals) */
      totalLines: 0,
      bestLinesGame: 0,
      bestCombo: 0,
      bestScoreGame: 0,
      pendingCoins: 0,
      unlocks: { golden: false, star: false },
      theme: "default"        /* default | golden | star */
    };
  }
  function loadData() {
    if (memData) return memData;
    var d = blank();
    if (hasStorage()) {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.daily && p.weekly) {
            d = p;
            d.missions = d.missions || {};
            d.unlocks = d.unlocks || { golden: false, star: false };
            if (typeof d.pendingCoins !== "number") d.pendingCoins = 0;
            if (!d.theme) d.theme = "default";
          }
        }
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
  function resetData() { memData = blank(); saveData(); }

  /* ---------------- streaks ---------------- */
  /* Current streak for display: 0 when the last played day is not today
     or yesterday (the streak is broken until the next daily is played). */
  function displayStreak(today) {
    var d = loadData();
    var last = d.daily.lastPlayed;
    if (!last) return 0;
    if (last === today || last === addDays(today, -1)) return d.daily.streak || 0;
    return 0;
  }

  /* ---------------- daily ---------------- */
  function getDaily(date) {
    var def = dailyDef(date);
    var d = loadData();
    var today = def.key;
    return {
      def: def,
      played: !!d.daily.played[today],
      won: d.daily.played[today] === "won",
      streak: displayStreak(today),
      lastPlayed: d.daily.lastPlayed,
      best: d.daily.best[today] || 0,
      unlocks: d.unlocks,
      theme: d.theme
    };
  }

  /* Record the end of today's daily. `won` = reached the goal.
     Idempotent: a second finish on the same day changes nothing.
     Returns { alreadyPlayed, streak, best, isNewBest, rewardCoins, unlocked: [] } */
  function recordDailyEnd(won, date) {
    var def = dailyDef(date);
    var today = def.key;
    var d = loadData();
    var out = { alreadyPlayed: false, streak: displayStreak(today), best: d.daily.best[today] || 0,
      isNewBest: false, rewardCoins: 0, unlocked: [] };
    var score = recordDailyEnd._score || 0;
    if (d.daily.played[today]) { out.alreadyPlayed = true; return out; }
    /* streak: yesterday -> +1, otherwise restart at 1 */
    if (d.daily.lastPlayed === addDays(today, -1)) d.daily.streak = (d.daily.streak || 0) + 1;
    else d.daily.streak = 1;
    d.daily.lastPlayed = today;
    d.daily.played[today] = won ? "won" : "played";
    if (won) {
      if (score > (d.daily.best[today] || 0)) { d.daily.best[today] = score; out.isNewBest = true; }
      out.best = d.daily.best[today];
      out.rewardCoins = DAILY_WIN_COINS;
      d.pendingCoins = (d.pendingCoins || 0) + DAILY_WIN_COINS;
    } else {
      out.best = d.daily.best[today] || 0;
      if (score > out.best) { d.daily.best[today] = score; out.best = score; out.isNewBest = true; }
    }
    out.streak = d.daily.streak;
    /* milestone unlocks */
    if (d.daily.streak >= 7 && !d.unlocks.golden) { d.unlocks.golden = true; out.unlocked.push("golden"); }
    if (d.daily.streak >= 30 && !d.unlocks.star) { d.unlocks.star = true; out.unlocked.push("star"); }
    checkStreakMission(today);
    saveData();
    return out;
  }
  /* The UI sets the just-finished run's score here before calling
     recordDailyEnd / recordWeeklyEnd (keeps the call signature simple). */
  recordDailyEnd._score = 0;
  recordWeeklyEnd._score = 0;

  /* ---------------- weekly ---------------- */
  function getWeekly(date) {
    var def = weeklyDef(date);
    var d = loadData();
    return {
      def: def,
      done: d.weekly.badges.indexOf(def.key) >= 0,
      badges: d.weekly.badges.slice(),
      best: d.weekly.best[def.key] || 0,
      unlocks: d.unlocks,
      theme: d.theme
    };
  }

  /* Record the end of this week's challenge. Winning earns the badge
     (+100 coins). Idempotent within the week.
     Returns { alreadyDone, badgeEarned, best, isNewBest, rewardCoins } */
  function recordWeeklyEnd(won, date) {
    var def = weeklyDef(date);
    var key = def.key;
    var d = loadData();
    var score = recordWeeklyEnd._score || 0;
    var out = { alreadyDone: false, badgeEarned: false, best: d.weekly.best[key] || 0,
      isNewBest: false, rewardCoins: 0 };
    if (score > (d.weekly.best[key] || 0)) { d.weekly.best[key] = score; out.isNewBest = true; }
    out.best = d.weekly.best[key];
    if (d.weekly.badges.indexOf(key) >= 0) { out.alreadyDone = true; saveData(); return out; }
    if (!won) { saveData(); return out; }
    d.weekly.badges.push(key);
    out.badgeEarned = true;
    out.rewardCoins = WEEKLY_WIN_COINS;
    d.pendingCoins = (d.pendingCoins || 0) + WEEKLY_WIN_COINS;
    saveData();
    return out;
  }

  /* ---------------- missions ---------------- */
  function missionProgress(m) {
    var d = loadData();
    switch (m.id) {
      case "lines5":    return Math.min(m.target, d.bestLinesGame || 0);
      case "combo3":    return Math.min(m.target, d.bestCombo || 0);
      case "score1000": return Math.min(m.target, d.bestScoreGame || 0);
      case "streak7":   return Math.min(m.target, displayStreak(dateKey()));
      case "lines50":   return Math.min(m.target, d.totalLines || 0);
    }
    return 0;
  }

  function getMissions() {
    var d = loadData();
    return MISSIONS.map(function (m) {
      var p = missionProgress(m);
      return {
        id: m.id, icon: m.icon, target: m.target, reward: m.reward,
        titleKey: m.titleKey, descKey: m.descKey,
        progress: p, done: !!d.missions[m.id] || p >= m.target
      };
    });
  }

  function missionsDoneCount() {
    return getMissions().filter(function (m) { return m.done; }).length;
  }

  function checkStreakMission(today) {
    var d = loadData();
    if (displayStreak(today || dateKey()) >= 7) completeMission("streak7");
  }

  /* Mark a mission done and bank its reward. Returns true on first completion. */
  function completeMission(id) {
    var d = loadData();
    if (d.missions[id]) return false;
    var m = null;
    MISSIONS.forEach(function (x) { if (x.id === id) m = x; });
    if (!m) return false;
    d.missions[id] = { done: true };
    d.pendingCoins = (d.pendingCoins || 0) + m.reward;
    saveData();
    return true;
  }

  /* Run tracking — the UI feeds engine events here. `ev` is the raw engine
     event object (place / clear / gameover / newgame). Returns the list of
     mission ids that completed because of this event (for the toast). */
  var run = { lines: 0, bestCombo: 0, score: 0 };
  function onRunEvent(ev) {
    if (!ev) return [];
    var completed = [];
    if (ev.type === "newgame") {
      run = { lines: 0, bestCombo: 0, score: 0 };
      return completed;
    }
    if (ev.type === "place") {
      run.score = ev.score || run.score;
      return completed;
    }
    if (ev.type === "clear") {
      run.lines += ev.lines || 0;
      if (ev.combo && ev.combo > run.bestCombo) run.bestCombo = ev.combo;
      run.score = ev.score || run.score;
      return completed;
    }
    if (ev.type !== "gameover") return completed;
    var d = loadData();
    run.score = ev.score || run.score;
    run.lines = (typeof ev.linesCleared === "number") ? ev.linesCleared : run.lines;
    run.bestCombo = Math.max(run.bestCombo, ev.bestCombo || 0);
    d.totalLines = (d.totalLines || 0) + run.lines;
    if (run.lines > (d.bestLinesGame || 0)) d.bestLinesGame = run.lines;
    if (run.bestCombo > (d.bestCombo || 0)) d.bestCombo = run.bestCombo;
    if (run.score > (d.bestScoreGame || 0)) d.bestScoreGame = run.score;
    /* evaluate missions against the updated totals */
    MISSIONS.forEach(function (m) {
      if (d.missions[m.id]) return;
      if (missionProgress(m) >= m.target && completeMission(m.id)) completed.push(m.id);
    });
    saveData();
    return completed;
  }

  function missionById(id) {
    var found = null;
    MISSIONS.forEach(function (m) { if (m.id === id) found = m; });
    return found;
  }

  /* ---------------- coins ---------------- */
  function getPendingCoins() { return (loadData().pendingCoins || 0); }

  /* Flush banked reward coins into the game's coin counter. Only safe at
     run end (see header). Writes BOTH coin stores (engine + UI) and
     updates the on-screen counter when the UI is present. Idempotent. */
  function flushPendingCoins() {
    var d = loadData();
    var n = d.pendingCoins || 0;
    if (n <= 0) return 0;
    d.pendingCoins = 0;
    saveData();
    var total = n;
    if (hasStorage()) {
      try {
        var cur = parseInt(localStorage.getItem(ENGINE_COINS_KEY), 10);
        if (isNaN(cur)) cur = 0;
        total = cur + n;
        localStorage.setItem(ENGINE_COINS_KEY, String(total));
        localStorage.setItem(UI_COINS_KEY, String(total));
      } catch (e) { /* private mode — UI counter still updates below */ }
    }
    /* Bank the reward into the ENGINE's own coin counter too. Without this,
       the next board sync (pop animation callback) re-reads engine state
       and wipes the flushed reward. setCoins is an additive API (game.js)
       — it only sets the counter, it changes no game rule. */
    if (typeof window !== "undefined" && window.MiloPop && typeof window.MiloPop.setCoins === "function") {
      try { window.MiloPop.setCoins(total); } catch (e) { /* engine not ready */ }
    }
    if (typeof window !== "undefined" && window.MiloPopUI && typeof window.MiloPopUI.setCoins === "function") {
      try {
        var st = window.MiloPopUI.getState ? window.MiloPopUI.getState() : null;
        window.MiloPopUI.setCoins(Math.max(total, (st && st.coins) || 0));
      } catch (e) { /* UI not ready */ }
    }
    return n;
  }

  /* ---------------- themes / skins (streak rewards) ---------------- */
  function getUnlocks() {
    var d = loadData();
    return { golden: !!d.unlocks.golden, star: !!d.unlocks.star };
  }
  function getTheme() { return loadData().theme || "default"; }
  /* Equip a theme. 'default' is always allowed; 'golden' needs the
     7-day unlock, 'star' the 30-day unlock. Returns the active theme. */
  function setTheme(id) {
    var d = loadData();
    if (id === "golden" && !d.unlocks.golden) return d.theme || "default";
    if (id === "star" && !d.unlocks.star) return d.theme || "default";
    if (id !== "default" && id !== "golden" && id !== "star") return d.theme || "default";
    d.theme = id;
    saveData();
    return d.theme;
  }
  function applyThemeToDom() {
    if (typeof document === "undefined") return;
    var th = getTheme();
    /* Golden theme re-skins the page background (which lives on <body>). */
    if (document.body) document.body.classList.toggle("theme-golden", th === "golden");
    var app = document.getElementById("app");
    if (!app) return;
    app.classList.toggle("theme-golden", th === "golden");
    app.classList.toggle("skin-star", th === "star");
  }

  /* ---------------- test hooks ---------------- */
  function debugSet(patch) {
    var d = loadData();
    if (patch) {
      Object.keys(patch).forEach(function (k) {
        if (k === "daily" || k === "weekly" || k === "unlocks") {
          Object.keys(patch[k]).forEach(function (j) { d[k][j] = patch[k][j]; });
        } else d[k] = patch[k];
      });
    }
    saveData();
    return d;
  }

  var api = {
    MISSIONS: MISSIONS,
    DAILY_WIN_COINS: DAILY_WIN_COINS,
    WEEKLY_WIN_COINS: WEEKLY_WIN_COINS,
    dateKey: dateKey,
    addDays: addDays,
    weekKey: weekKey,
    prettyDate: prettyDate,
    dailyDef: dailyDef,
    weeklyDef: weeklyDef,
    starsFor: starsFor,
    getDaily: getDaily,
    getWeekly: getWeekly,
    recordDailyEnd: recordDailyEnd,
    recordWeeklyEnd: recordWeeklyEnd,
    displayStreak: displayStreak,
    getMissions: getMissions,
    missionsDoneCount: missionsDoneCount,
    missionById: missionById,
    onRunEvent: onRunEvent,
    getPendingCoins: getPendingCoins,
    flushPendingCoins: flushPendingCoins,
    getUnlocks: getUnlocks,
    getTheme: getTheme,
    setTheme: setTheme,
    applyThemeToDom: applyThemeToDom,
    _reset: resetData,
    _debugSet: debugSet
  };

  if (typeof window !== "undefined") window.MiloChallenges = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

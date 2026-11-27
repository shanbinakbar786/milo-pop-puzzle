/* Milo Pop Puzzle — Backup & Restore (final release).
   "Cloud save" without a server: ALL progress lives in localStorage, so
   the backup is a complete export of every progress key, as a downloadable
   JSON file OR a short copy-paste backup code (same data, base64url).

   What is backed up (everything the game stores):
     engine:  best score, coins, games played      (milo-pop-*)
     adventure: all 500 level stars/best scores    (mpp_adv_v1)
     challenges: daily streak + history, weekly badges, missions,
                 totals, pending coins, theme unlocks + active theme
                                                       (mpp_chal_v1)
     settings: language, mute, difficulty, home coins/best,
               adventure map tab/world              (mpp_*)
   Restore VALIDATES the file/code FIRST and never touches existing
   progress when it is invalid (bad JSON, wrong app, wrong version, bad
   types, impossible values) — it shows an error instead. A valid restore
   writes the keys, then the page reloads so every module re-reads its
   own store from localStorage (the modules cache in memory, so a reload
   is the only 100%-correct way to pick up restored data).
   No sign-in, no account, no server, no ads, no purchases. */
(function () {
  "use strict";

  var APP = "milo-pop-puzzle";
  var VERSION = 1;
  var CODE_PREFIX = "MPP1.";
  var ADV_KEY = "mpp_adv_v1";
  var CHAL_KEY = "mpp_chal_v1";
  var ENGINE_KEYS = { best: "milo-pop-best-score", coins: "milo-pop-coins", games: "milo-pop-games-played" };
  var SETTING_KEYS = ["lang", "muted", "difficulty", "coins", "best", "advDiff", "advWorld"];
  var LANGS = ["en", "ur", "es", "fr", "pt", "de", "ar", "zh", "hi", "tr"];

  function hasStorage() { try { return typeof localStorage !== "undefined" && !!localStorage.getItem; } catch (e) { return false; } }
  function readRaw(key) {
    if (!hasStorage()) return null;
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function readInt(key, fallback) {
    var v = parseInt(readRaw(key), 10);
    return isNaN(v) ? fallback : v;
  }
  function readJson(key) {
    var raw = readRaw(key);
    if (!raw) return null;
    try { var p = JSON.parse(raw); return (p && typeof p === "object") ? p : null; }
    catch (e) { return null; }
  }
  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
  function isNonNegInt(n) { return isInt(n) && n >= 0; }

  /* ---------------- collect ---------------- */
  function collect() {
    var adv = readJson(ADV_KEY);
    var chal = readJson(CHAL_KEY);
    var settings = {};
    SETTING_KEYS.forEach(function (k) {
      var v = readRaw("mpp_" + k);
      if (v !== null) settings[k] = v;
    });
    return {
      app: APP,
      v: VERSION,
      exportedAt: new Date().toISOString(),
      engine: {
        best: Math.max(0, readInt(ENGINE_KEYS.best, 0)),
        coins: Math.max(0, readInt(ENGINE_KEYS.coins, 0)),
        games: Math.max(0, readInt(ENGINE_KEYS.games, 0))
      },
      adventure: adv || { v: 1, prog: {} },
      challenges: chal || null,
      settings: settings
    };
  }

  /* ---------------- validate (never trust input) ---------------- */
  function validate(data) {
    if (!data || typeof data !== "object") return { ok: false, error: "not-an-object" };
    if (data.app !== APP) return { ok: false, error: "wrong-app" };
    if (data.v !== VERSION) return { ok: false, error: "wrong-version" };
    if (!data.engine || typeof data.engine !== "object") return { ok: false, error: "no-engine" };
    if (!isNonNegInt(data.engine.best) || !isNonNegInt(data.engine.coins) || !isNonNegInt(data.engine.games))
      return { ok: false, error: "bad-engine" };
    if (data.engine.best > 10000000 || data.engine.coins > 10000000 || data.engine.games > 1000000)
      return { ok: false, error: "bad-engine" };
    if (!data.adventure || typeof data.adventure !== "object" || !data.adventure.prog || typeof data.adventure.prog !== "object")
      return { ok: false, error: "bad-adventure" };
    var keys = Object.keys(data.adventure.prog);
    if (keys.length > 500) return { ok: false, error: "bad-adventure" };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!/^(easy|medium)-[1-5]-\d{1,3}$/.test(k)) return { ok: false, error: "bad-adventure-key" };
      var p = data.adventure.prog[k];
      if (!p || typeof p !== "object" || !isInt(p.s) || p.s < 0 || p.s > 3 || !isNonNegInt(p.b) || p.b > 10000000)
        return { ok: false, error: "bad-adventure-value" };
    }
    if (data.challenges !== null && data.challenges !== undefined) {
      var c = data.challenges;
      if (typeof c !== "object" || !c.daily || typeof c.daily !== "object" || !c.weekly || typeof c.weekly !== "object")
        return { ok: false, error: "bad-challenges" };
      if (!isNonNegInt(c.totalLines || 0) || !isNonNegInt(c.bestLinesGame || 0) ||
          !isNonNegInt(c.bestCombo || 0) || !isNonNegInt(c.bestScoreGame || 0) ||
          !isNonNegInt(c.pendingCoins || 0))
        return { ok: false, error: "bad-challenges" };
      if (c.theme !== undefined && c.theme !== "default" && c.theme !== "golden" && c.theme !== "star")
        return { ok: false, error: "bad-theme" };
      if (c.unlocks !== undefined && (typeof c.unlocks !== "object" ||
          (c.unlocks.golden !== undefined && typeof c.unlocks.golden !== "boolean") ||
          (c.unlocks.star !== undefined && typeof c.unlocks.star !== "boolean")))
        return { ok: false, error: "bad-challenges" };
      if (c.missions !== undefined && typeof c.missions !== "object") return { ok: false, error: "bad-challenges" };
      if (c.daily.streak !== undefined && !isNonNegInt(c.daily.streak)) return { ok: false, error: "bad-challenges" };
      if (c.weekly.badges !== undefined && !Array.isArray(c.weekly.badges)) return { ok: false, error: "bad-challenges" };
    }
    if (data.settings !== undefined && data.settings !== null) {
      var s = data.settings;
      if (typeof s !== "object") return { ok: false, error: "bad-settings" };
      if (s.lang !== undefined && LANGS.indexOf(s.lang) < 0) return { ok: false, error: "bad-lang" };
      if (s.muted !== undefined && s.muted !== "true" && s.muted !== "false") return { ok: false, error: "bad-settings" };
      if (s.difficulty !== undefined && s.difficulty !== "easy" && s.difficulty !== "medium") return { ok: false, error: "bad-settings" };
    }
    return { ok: true };
  }

  /* ---------------- apply (only after validate passes) ---------------- */
  function apply(data) {
    var v = validate(data);
    if (!v.ok) return v;
    if (!hasStorage()) return { ok: false, error: "no-storage" };
    try {
      localStorage.setItem(ENGINE_KEYS.best, String(data.engine.best));
      localStorage.setItem(ENGINE_KEYS.coins, String(data.engine.coins));
      localStorage.setItem(ENGINE_KEYS.games, String(data.engine.games));
      localStorage.setItem(ADV_KEY, JSON.stringify(data.adventure));
      if (data.challenges) localStorage.setItem(CHAL_KEY, JSON.stringify(data.challenges));
      var s = data.settings || {};
      Object.keys(s).forEach(function (k) {
        if (SETTING_KEYS.indexOf(k) >= 0) localStorage.setItem("mpp_" + k, String(s[k]));
      });
    } catch (e) { return { ok: false, error: "write-failed" }; }
    return { ok: true };
  }

  /* ---------------- summary (shown before restoring) ---------------- */
  function summary(data) {
    if (!data || typeof data !== "object") return null;
    var stars = 0;
    var prog = (data.adventure && data.adventure.prog) || {};
    Object.keys(prog).forEach(function (k) { stars += (prog[k].s || 0); });
    var streak = 0;
    if (data.challenges && data.challenges.daily) streak = data.challenges.daily.streak || 0;
    var badges = 0;
    if (data.challenges && data.challenges.weekly && Array.isArray(data.challenges.weekly.badges))
      badges = data.challenges.weekly.badges.length;
    return {
      stars: stars, coins: data.engine ? data.engine.coins : 0,
      best: data.engine ? data.engine.best : 0, streak: streak, badges: badges,
      exportedAt: data.exportedAt || ""
    };
  }

  /* ---------------- file export ---------------- */
  function fileName() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return "milo-pop-puzzle-backup-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".json";
  }
  function exportFile() {
    if (typeof document === "undefined" || typeof Blob === "undefined") return { ok: false, error: "no-dom" };
    var json = JSON.stringify(collect());
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    return { ok: true, name: fileName() };
  }

  /* ---------------- backup code (base64url of the same JSON) ---------------- */
  function toB64(str) {
    var utf8 = unescape(encodeURIComponent(str)); /* ASCII-safe base64 */
    var b64 = (typeof btoa !== "undefined") ? btoa(utf8) : Buffer.from(utf8, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64(b64) {
    var s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = (typeof atob !== "undefined") ? atob(s) : Buffer.from(s, "base64").toString("binary");
    return decodeURIComponent(escape(bin));
  }
  function encodeCode() {
    return CODE_PREFIX + toB64(JSON.stringify(collect()));
  }
  function decodeCode(code) {
    var raw = String(code || "").trim();
    if (raw.indexOf(CODE_PREFIX) !== 0) return { ok: false, error: "bad-code-prefix" };
    var json;
    try { json = fromB64(raw.slice(CODE_PREFIX.length)); }
    catch (e) { return { ok: false, error: "bad-code" }; }
    var data;
    try { data = JSON.parse(json); }
    catch (e) { return { ok: false, error: "bad-code" }; }
    var v = validate(data);
    if (!v.ok) return v;
    return { ok: true, data: data };
  }
  function parseText(text) {
    var data;
    try { data = JSON.parse(String(text || "")); }
    catch (e) { return { ok: false, error: "bad-json" }; }
    var v = validate(data);
    if (!v.ok) return v;
    return { ok: true, data: data };
  }

  var api = {
    APP: APP,
    VERSION: VERSION,
    CODE_PREFIX: CODE_PREFIX,
    collect: collect,
    validate: validate,
    apply: apply,
    summary: summary,
    exportFile: exportFile,
    fileName: fileName,
    encodeCode: encodeCode,
    decodeCode: decodeCode,
    parseText: parseText
  };

  if (typeof window !== "undefined") window.MiloBackup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

/* Milo Pop Puzzle — OUR OWN in-house video ad (no ad network).
   ----------------------------------------------------------------------
   WEB TEST COPY (test-ad/): shows the bundled 20-second Purrfect Pet
   promo video fullscreen after EVERY Classic run end (on the web there
   is no AdMob to alternate with — see the APK build for the alternating
   version). The promo is bundled in the folder
   (purrfect-pet-promo-20s.mp4) — it plays offline, no download, no
   tracking, no ad network involved.

   Rules:
     - Fullscreen only after a Classic run ends — never on launch,
       never mid-game, never on a timer. The game-over screen is
       already showing behind the video; when the video closes, the
       player is right back on it.
     - Skip button appears after 5 seconds; when the video ends, a
       "Play Purrfect Pet" button + Close button appear.
     - "Play Purrfect Pet" (and tapping the video) opens
       https://purrfect-pet.netlify.app in the system browser
       (target=_blank — Capacitor opens it outside the game).
     - Sound: the promo plays with sound, unless the game's mute
       setting is on (window.MiloPopUI.isMuted()).
     - If the video file is missing or fails to play, the ad is
       skipped silently — the game never breaks, the game-over
       screen simply shows as normal.
*/
(function () {
  'use strict';

  var VIDEO_SRC = 'purrfect-pet-promo-20s.mp4';
  var GAME_URL = 'https://purrfect-pet.netlify.app';
  var SKIP_AFTER_MS = 5000;

  var overlay = null, video = null, skipBtn = null, endCard = null, tapPlayBtn = null;
  var skipTimer = null, active = false, broken = false, built = false;

  function isMuted() {
    try {
      if (window.MiloPopUI && typeof window.MiloPopUI.isMuted === 'function') return !!window.MiloPopUI.isMuted();
    } catch (e) { /* fall through */ }
    return false;
  }

  /* Open the game link in the SYSTEM browser, never inside the game. */
  function openGameLink() {
    try {
      var a = document.createElement('a');
      a.href = GAME_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      try { window.open(GAME_URL, '_blank'); } catch (e2) { /* never break the game */ }
    }
  }

  function el(tag, id, text) {
    var n = document.createElement(tag);
    if (id) n.id = id;
    if (text) n.textContent = text;
    return n;
  }

  function buildOverlay() {
    if (built) return;
    built = true;
    overlay = el('div', 'promo-ad-overlay');
    overlay.style.display = 'none';

    video = document.createElement('video');
    video.setAttribute('src', VIDEO_SRC);
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'auto');
    video.addEventListener('ended', function () { showEndCard(); });
    video.addEventListener('error', function () {
      if (active) finish();      /* failed mid-play: close silently */
      else broken = true;        /* failed before showing: never show */
    });
    video.addEventListener('click', function () { openGameLink(); });

    skipBtn = el('button', 'promo-ad-skip', 'Skip ✕');
    skipBtn.style.display = 'none';
    skipBtn.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      finish();
    });

    tapPlayBtn = el('button', 'promo-ad-tapplay', '▶ Play video');
    tapPlayBtn.style.display = 'none';
    tapPlayBtn.addEventListener('click', function () {
      tapPlayBtn.style.display = 'none';
      try { video.play(); } catch (e) { finish(); }
    });

    endCard = el('div', 'promo-ad-end');
    endCard.style.display = 'none';
    var playLink = el('a', 'promo-ad-play', '🐾 Play Purrfect Pet');
    playLink.className = 'big-btn green';
    playLink.href = GAME_URL;
    playLink.target = '_blank';
    playLink.rel = 'noopener';
    var closeBtn = el('button', 'promo-ad-close', '✕ Close');
    closeBtn.addEventListener('click', function () { finish(); });
    endCard.appendChild(playLink);
    endCard.appendChild(closeBtn);

    overlay.appendChild(video);
    overlay.appendChild(skipBtn);
    overlay.appendChild(tapPlayBtn);
    overlay.appendChild(endCard);
    document.body.appendChild(overlay);
  }

  function showEndCard() {
    if (skipBtn) skipBtn.style.display = 'none';
    if (endCard) endCard.style.display = 'flex';
  }

  function finish() {
    if (!active) return;
    active = false;
    if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
    try { if (video) video.pause(); } catch (e) { /* already stopped */ }
    if (overlay) overlay.style.display = 'none';
  }

  /* Show the promo. Returns true if it is showing, false if it must be
     skipped (file missing/broken) — the caller then shows nothing and
     the game-over screen stays visible. */
  function maybeShow() {
    try { buildOverlay(); } catch (e) { return false; }
    if (broken || active) return false;
    active = true;
    endCard.style.display = 'none';
    skipBtn.style.display = 'none';
    tapPlayBtn.style.display = 'none';
    overlay.style.display = 'flex';
    try { video.muted = isMuted(); } catch (e) {}
    try { video.currentTime = 0; } catch (e) {}
    skipTimer = setTimeout(function () {
      if (active && skipBtn) skipBtn.style.display = 'block';
    }, SKIP_AFTER_MS);
    var p = null;
    try { p = video.play(); } catch (e) { p = null; }
    if (p && typeof p.catch === 'function') {
      p.catch(function () {
        /* Autoplay blocked (no user gesture yet): offer tap-to-play. */
        if (active && tapPlayBtn) tapPlayBtn.style.display = 'block';
      });
    }
    return true;
  }

  window.MiloPromoAd = {
    maybeShow: maybeShow,
    isActive: function () { return active; }
  };

  /* Build the overlay early (once the page exists) so the bundled video
     starts loading in the background: by the time a run ends we already
     know whether the file is playable, and a broken file is skipped
     with no flash on screen. */
  function init() {
    try { buildOverlay(); } catch (e) { /* overlay builds on first use */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

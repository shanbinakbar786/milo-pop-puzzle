// Milo Pop Puzzle — Audio API
// Original, claim-free audio only (see audio/CREDITS.md).
// Music plays soft in the background (~5% feel); mute silences everything.
(function (global) {
  'use strict';

  var MUSIC_VOLUME = 0.35; // file is rendered soft; element volume keeps it gentle
  var SFX_VOLUME = 0.9;

  var musicEl = null;
  var muted = false;
  var sfxCache = {};

  try {
    muted = localStorage.getItem('milo-pop-muted') === '1';
  } catch (e) { /* storage unavailable — default unmuted */ }

  function makeAudio(src) {
    var a = new Audio(src);
    a.preload = 'auto';
    return a;
  }

  function getSfx(name) {
    if (!sfxCache[name]) {
      sfxCache[name] = makeAudio('audio/' + name + '.mp3');
      sfxCache[name].volume = SFX_VOLUME;
    }
    return sfxCache[name];
  }

  function playSfx(name) {
    if (muted) return;
    try {
      var a = getSfx(name);
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked — ignore */ });
    } catch (e) { /* audio unavailable — ignore */ }
  }

  var AudioAPI = {
    isMuted: function () { return muted; },

    setMuted: function (value) {
      muted = !!value;
      try { localStorage.setItem('milo-pop-muted', muted ? '1' : '0'); } catch (e) {}
      if (musicEl) musicEl.muted = muted;
      if (muted) {
        if (musicEl) musicEl.pause();
      } else if (musicEl) {
        var p = musicEl.play();
        if (p && p.catch) p.catch(function () {});
      }
      return muted;
    },

    toggleMuted: function () { return this.setMuted(!muted); },

    playMusic: function () {
      if (muted) return;
      try {
        if (!musicEl) {
          musicEl = makeAudio('audio/music.mp3');
          musicEl.loop = true;
          musicEl.volume = MUSIC_VOLUME;
          musicEl.muted = muted;
        }
        if (musicEl.paused) {
          var p = musicEl.play();
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) { /* audio unavailable — ignore */ }
    },

    stopMusic: function () {
      if (musicEl) { musicEl.pause(); musicEl.currentTime = 0; }
    },

    playPop: function () { playSfx('pop'); },
    playCombo: function () { playSfx('combo'); },
    playGameOver: function () { playSfx('gameover'); },
    playClick: function () { playSfx('click'); }
  };

  // Start music on first user gesture (browsers block autoplay before interaction).
  function unlockOnGesture() {
    AudioAPI.playMusic();
    document.removeEventListener('pointerdown', unlockOnGesture);
    document.removeEventListener('keydown', unlockOnGesture);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', unlockOnGesture);
    document.addEventListener('keydown', unlockOnGesture);
  }

  global.MiloAudio = AudioAPI;
})(typeof window !== 'undefined' ? window : this);

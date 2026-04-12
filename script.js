/* ==========================================================
   script.js — peijumu zzz
   Handles:
     - Audio playback (single track at a time)
     - Desktop hover preview / click full play
     - Mobile tap full play
     - Mini player UI (title, type, progress, play/pause)
     - Active object visual state
   ========================================================== */

'use strict';

/* ----------------------------------------------------------
   DOM References
   ---------------------------------------------------------- */
const roomScene    = document.getElementById('roomScene');
const miniPlayer   = document.getElementById('miniPlayer');
const playerTitle  = document.getElementById('playerTitle');
const playerType   = document.getElementById('playerType');
const playerBtn    = document.getElementById('playerBtn');
const playerStop   = document.getElementById('playerStop');
const progressBar  = document.getElementById('playerProgress');

/* ----------------------------------------------------------
   State
   ---------------------------------------------------------- */
let currentAudio    = null;    // the active HTMLAudioElement
let currentObject   = null;    // the active .room-object element
let previewTimeout  = null;    // timer to stop hover previews
let isPlaying       = false;

/* ----------------------------------------------------------
   Mobile detection
   Using pointer media query — more reliable than userAgent.
   ---------------------------------------------------------- */
const isMobile = () => !window.matchMedia('(hover: hover)').matches;

/* ----------------------------------------------------------
   Audio Manager
   ---------------------------------------------------------- */

/**
 * Play a track from a given source.
 * Stops any currently playing audio first.
 *
 * @param {string} src       - Path to audio file (e.g. "assets/audio/song1.mp3")
 * @param {string} title     - Track name for the mini player
 * @param {string} type      - Genre/mood label
 * @param {Element} objEl    - The room-object element that triggered play
 * @param {number}  startAt  - Optional: start time in seconds (for previews)
 */
function playTrack(src, title, type, objEl, startAt = 0) {
  // Stop whatever is currently playing
  stopAll();

  // Create and configure new audio element
  const audio = new Audio(src);
  audio.currentTime = startAt;
  audio.volume = 1;

  // Gracefully handle missing audio files (placeholder paths)
  audio.addEventListener('error', () => {
    console.warn(`[peijumu zzz] Audio not found: ${src}. Add your file to assets/audio/`);
    setPlayerState(title, type, false);
  });

  // Update progress bar while playing
  audio.addEventListener('timeupdate', updateProgress);

  // Reset when track ends
  audio.addEventListener('ended', () => {
    isPlaying = false;
    setPlayerState(title, type, false);
    if (currentObject) currentObject.classList.remove('is-playing');
    progressBar.style.width = '0%';
  });

  // Play (may be blocked by browser autoplay policy — user gesture required)
  audio.play().catch(err => {
    console.warn('[peijumu zzz] Playback blocked:', err.message);
  });

  // Update state
  currentAudio  = audio;
  currentObject = objEl;
  isPlaying     = true;

  // Mark object as playing
  document.querySelectorAll('.room-object.is-playing').forEach(el => el.classList.remove('is-playing'));
  if (objEl) objEl.classList.add('is-playing');

  // Update player UI
  setPlayerState(title, type, true);
  miniPlayer.classList.add('visible');
}

/** Stop all playback and reset state. */
function stopAll() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';   // release resource
    currentAudio = null;
  }
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = null;
  }
  if (currentObject) {
    currentObject.classList.remove('is-playing');
    currentObject = null;
  }
  isPlaying = false;
  progressBar.style.width = '0%';
}

/* ----------------------------------------------------------
   Mini Player UI
   ---------------------------------------------------------- */

/**
 * Update the player display.
 * @param {string}  title     - Track name
 * @param {string}  type      - Genre label
 * @param {boolean} playing   - Whether audio is playing
 */
function setPlayerState(title, type, playing) {
  playerTitle.textContent = title;
  playerType.textContent  = type.toUpperCase();
  isPlaying = playing;

  if (playing) {
    miniPlayer.classList.add('is-playing');
  } else {
    miniPlayer.classList.remove('is-playing');
  }
}

/** Update progress bar from audio timeupdate event. */
function updateProgress() {
  if (!currentAudio || !currentAudio.duration) return;
  const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
  progressBar.style.width = pct + '%';
}

/* ----------------------------------------------------------
   Mini Player Button Handlers
   ---------------------------------------------------------- */

// Play / Pause toggle
playerBtn.addEventListener('click', () => {
  if (!currentAudio) return;

  if (isPlaying) {
    currentAudio.pause();
    isPlaying = false;
    miniPlayer.classList.remove('is-playing');
  } else {
    currentAudio.play().catch(() => {});
    isPlaying = true;
    miniPlayer.classList.add('is-playing');
  }
});

// Stop — stop everything and hide player
playerStop.addEventListener('click', () => {
  stopAll();
  miniPlayer.classList.remove('is-playing');
  playerTitle.textContent = '— nothing playing —';
  playerType.textContent  = '';
  // Keep player visible so user sees the reset
});

/* ----------------------------------------------------------
   Room Object Interactions
   ---------------------------------------------------------- */

/**
 * Attach event listeners to a single room object element.
 * Behaviour differs between desktop (hover preview + click) and mobile (tap).
 */
function attachObjectListeners(el) {
  const src   = el.dataset.src;
  const title = el.dataset.title;
  const type  = el.dataset.type || '';

  if (!src) return;

  /* ── DESKTOP BEHAVIOUR ──────────────────────────────── */

  // Hover in → short preview (first 8 seconds)
  el.addEventListener('mouseenter', () => {
    if (isMobile()) return;
    if (currentObject === el && isPlaying) return; // already playing this track

    // Delay preview slightly so quick passes don't trigger it
    previewTimeout = setTimeout(() => {
      playTrack(src, title, type, el, 0);

      // Stop preview after 8 seconds unless user clicked
      previewTimeout = setTimeout(() => {
        if (currentObject === el && isPlaying && !el.dataset.fullPlay) {
          stopAll();
          setPlayerState(title, type, false);
          miniPlayer.classList.remove('is-playing');
        }
      }, 8000);
    }, 300);
  });

  // Hover out → cancel pending preview; let playing tracks continue
  el.addEventListener('mouseleave', () => {
    if (isMobile()) return;
    if (previewTimeout) {
      clearTimeout(previewTimeout);
      previewTimeout = null;
    }
    // Remove full-play flag
    delete el.dataset.fullPlay;
  });

  // Click → play full track (or toggle if same track is already playing)
  el.addEventListener('click', () => {
    if (isMobile()) return;

    if (currentObject === el && isPlaying) {
      // Same object clicked again → pause/resume
      playerBtn.click();
      return;
    }

    el.dataset.fullPlay = 'true';
    playTrack(src, title, type, el, 0);
  });

  /* ── MOBILE BEHAVIOUR ───────────────────────────────── */

  // Tap → toggle play / pause
  el.addEventListener('touchend', (e) => {
    e.preventDefault();  // prevent ghost click

    if (currentObject === el && isPlaying) {
      playerBtn.click();
      return;
    }

    playTrack(src, title, type, el, 0);
  }, { passive: false });

  /* ── KEYBOARD ACCESSIBILITY ─────────────────────────── */
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (currentObject === el && isPlaying) {
        playerBtn.click();
      } else {
        playTrack(src, title, type, el, 0);
      }
    }
  });
}

/* ----------------------------------------------------------
   Initialise
   ---------------------------------------------------------- */
function init() {
  // Attach listeners to all room objects
  document.querySelectorAll('.room-object').forEach(attachObjectListeners);

  // Initial player text (player starts hidden via CSS opacity:0)
  playerTitle.textContent = '— nothing playing —';
  playerType.textContent  = '';

  // Subtle: add a small random offset to each object's position
  // to make the room feel slightly organic (±5px)
  document.querySelectorAll('.room-object').forEach(el => {
    const dx = (Math.random() - 0.5) * 8;
    const dy = (Math.random() - 0.5) * 8;
    const currentTransform = el.style.transform || '';
    // Only nudge objects that don't have a deliberate perspective transform
    if (!el.classList.contains('obj-rug')) {
      el.style.setProperty('--nudge-x', `${dx}px`);
      el.style.setProperty('--nudge-y', `${dy}px`);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

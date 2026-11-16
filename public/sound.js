// Game sounds and haptics. Synthesised with Web Audio, so there are no audio files to load or license.
// Like Duolingo's set: one base chime varied per judgement, a pitch that climbs with the combo,
// and one bigger sound kept for finishing the Daily Starter. Haptics on Android and iPhone (see haptic()).
import { icon } from './links.js';

const KEY = 'hub-sound';
let ctx, on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* private mode: sound stays on for this visit */ }

// iOS only lets audio start inside a tap, so the context is created or resumed on the first touches.
const unlock = () => {
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state !== 'running') ctx.resume(); } catch { /* no Web Audio */ }
};
for (const type of ['pointerdown', 'touchend', 'click']) addEventListener(type, unlock, { passive: true });

const hz = (semi) => 523.25 * 2 ** (semi / 12); // semitones above C5
function tone(semi, at, dur, vol = 0.16, type = 'triangle') {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
  o.type = type; o.frequency.value = hz(semi);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

// [notes as [semitones, start s, length s, volume, wave], vibration pattern in ms]
const SOUNDS = {
  perfect: (s) => [[[7 + s, 0, 0.12], [12 + s, 0.07, 0.22]], 12],
  good: () => [[[7, 0, 0.12, 0.12], [9, 0.07, 0.2, 0.1]], 12],
  miss: () => [[[-9, 0, 0.16, 0.2, 'sine'], [-13, 0.09, 0.26, 0.2, 'sine']], [30, 40, 30]],
  combo: (s) => [[[12 + s, 0, 0.1], [16 + s, 0.06, 0.1], [19 + s, 0.12, 0.3]], [15, 30, 15]],
  done: () => [[[0, 0, 0.16], [4, 0.1, 0.16], [7, 0.2, 0.16], [12, 0.3, 0.5, 0.2], [16, 0.3, 0.5, 0.1]], [20, 40, 20, 40, 60]],
};

// step: semitones up (capped at an octave), so a combo climbs.
export function play(kind, step = 0) {
  if (!on) return;
  const [notes, buzz] = SOUNDS[kind](Math.min(step, 12));
  try { if (ctx?.state === 'running') for (const [semi, at, dur, vol, type] of notes) tone(semi, at, dur, vol, type); } catch { /* audio is a bonus */ }
  haptic(buzz);
}

// Android vibrates. iPhones have no vibration API, but Safari (iOS 18+) gives a haptic tick when a
// switch-style checkbox is toggled, so a hidden one is tapped instead. One tick, no patterns.
// shortcut: relies on that Safari behaviour; drop it if Apple ships navigator.vibrate or a haptics API.
let tick;
function haptic(pattern) {
  if ('vibrate' in navigator) { navigator.vibrate(pattern); return; }
  if (!tick) {
    tick = Object.assign(document.createElement('label'), { ariaHidden: 'true' });
    tick.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0;pointer-events:none';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', tabIndex: -1 });
    box.setAttribute('switch', '');
    tick.append(box);
    document.body.append(tick);
  }
  tick.click();
}

// The mute button for a run's HUD row. The choice is remembered on this device.
export function soundToggle() {
  const b = document.createElement('button');
  b.className = 'btn-icon sound';
  const show = () => {
    b.replaceChildren(icon(on ? 'volume' : 'volume-off'));
    b.ariaPressed = String(!on); b.ariaLabel = 'Mute sounds'; b.title = on ? 'Mute sounds' : 'Turn sounds on';
  };
  b.onclick = () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not remembered, still applies now */ }
    show();
  };
  show();
  return b;
}

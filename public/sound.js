// Game feedback: sounds, haptics and confetti. Sounds are synthesised with Web Audio, so there are no files to load or license.
// Like Duolingo's set: one base chime varied per judgement, a pitch that climbs with the combo,
// and one bigger sound kept for finishing the Daily Starter. Haptics on Android and iPhone (see haptic()).
import { icon } from './links.js';

const KEY = 'hub-sound';
let ctx, on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* private mode: sound stays on for this visit */ }

// iPhone: Safari puts Web Audio in the "ambient" session, which the Silent switch mutes, so Hub was silent on most
// phones. "playback" plays through Silent mode (iOS 17+), but like any media app it pauses music from other apps
// while sound is on. Muting Hub hands the session back.
const session = () => { if (navigator.audioSession) navigator.audioSession.type = on ? 'playback' : 'auto'; };
session();

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
  clear: () => [[[4, 0, 0.12], [7, 0.08, 0.12], [12, 0.16, 0.35]], [15, 30, 15]], // a practice game finished
  ready: () => [[[12, 0, 0.14, 0.1, 'sine'], [19, 0.1, 0.3, 0.1, 'sine']], 12], // a link's cards are ready
  tick: () => [[[-5, 0, 0.05, 0.08, 'square']], 0], // last seconds of the Speed round
};

// step: semitones up (capped at an octave), so a combo climbs.
export function play(kind, step = 0) {
  if (!on || !ctx) return;
  const [notes, buzz] = SOUNDS[kind](Math.min(step, 12));
  const go = () => { for (const [semi, at, dur, vol, type] of notes) tone(semi, at, dur, vol, type); };
  // Back from another app, iOS leaves the context "interrupted": resume first instead of dropping the sound.
  try { if (ctx.state === 'running') go(); else ctx.resume().then(go, () => {}); } catch { /* audio is a bonus */ }
  if (buzz) haptic(buzz);
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

export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Confetti in the lane colours, bursting from `from` (or the middle of the screen). Kept for the peaks only
// (the day done, a streak milestone, a flawless run, a new best) so it stays a reward and not wallpaper.
export function confetti(from, count = 70) {
  if (calm()) return;
  const r = from?.getBoundingClientRect(), x0 = r ? r.left + r.width / 2 : innerWidth / 2, y0 = r ? r.top + r.height / 2 : innerHeight / 2;
  const layer = Object.assign(document.createElement('div'), { className: 'confetti', ariaHidden: 'true' });
  layer.style.cssText = `--x:${x0}px;--y:${y0}px`;
  for (let i = 0; i < count; i++) {
    const p = layer.appendChild(document.createElement('i'));
    p.style.background = `var(--${['coral', 'gold', 'mint', 'blue'][i % 4]})`;
    const dx = (Math.random() - 0.5) * innerWidth, up = innerHeight * (0.2 + Math.random() * 0.3), spin = (Math.random() - 0.5) * 1440;
    p.animate([
      { transform: 'translate(0, 0) rotate(0deg)' },
      { transform: `translate(${dx * 0.5}px, ${-up}px) rotate(${spin / 2}deg)`, offset: 0.3, easing: 'ease-in' },
      { transform: `translate(${dx}px, ${innerHeight - y0 + 40}px) rotate(${spin}deg)` },
    ], { duration: 1800 + Math.random() * 900, delay: Math.random() * 150, easing: 'cubic-bezier(.15,.7,.4,1)', fill: 'both' });
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3000);
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
    session();
    show();
    play('perfect'); // so turning sound on is heard at once
  };
  show();
  return b;
}

// Share a key idea as a picture: drawn on a canvas in Hub's colours, sent through the phone's share sheet,
// or saved as a PNG where the browser can't share files (most desktops).
const LANES = ['#ff5a36', '#ffc42e', '#2fd3a4', '#4d7cff'];
const W = 1080, H = 1350, PAD = 80, TEXT = W - 2 * PAD - 80;

// Breaks text into lines that fit the width, at most `max` lines (the last one gets an ellipsis).
function lines(ctx, text, width, max) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  if (out.length > max) { out.length = max; out[max - 1] = `${out[max - 1].replace(/\s*\S*$/, '')}…`; }
  return out;
}

async function draw(k, title, lane) {
  await document.fonts?.load('800 64px Unbounded').catch(() => {});
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), ctx = c.getContext('2d');
  ctx.fillStyle = '#1d1647'; ctx.fillRect(0, 0, W, H);
  // The idea card: panel colour with its lane on top, like on the Learn tab.
  const top = 200, bottom = H - 220;
  ctx.fillStyle = '#251d5a'; ctx.beginPath(); ctx.roundRect(PAD, top, W - 2 * PAD, bottom - top, 40); ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = LANES[lane % 4]; ctx.fillRect(PAD, top, W - 2 * PAD, 18); ctx.restore();
  ctx.textBaseline = 'top';
  // Measure first, so the text block sits in the middle of the card however long it is.
  ctx.font = '800 64px Unbounded, system-ui, sans-serif';
  const head = lines(ctx, k.point, TEXT, 6);
  ctx.font = '400 40px system-ui, sans-serif';
  const body = k.explain ? lines(ctx, k.explain, TEXT, Math.max(1, Math.floor((bottom - top - 260 - head.length * 82) / 56))) : [];
  let y = top + Math.max(90, (bottom - top - (80 + head.length * 82 + (body.length ? 30 + body.length * 56 : 0))) / 2);
  ctx.fillStyle = '#c4bcef'; ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillText('KEY IDEA', PAD + 40, y); y += 80;
  ctx.fillStyle = '#f8f4ff'; ctx.font = '800 64px Unbounded, system-ui, sans-serif';
  for (const l of head) { ctx.fillText(l, PAD + 40, y); y += 82; }
  y += 30;
  ctx.fillStyle = '#c4bcef'; ctx.font = '400 40px system-ui, sans-serif';
  for (const l of body) { ctx.fillText(l, PAD + 40, y); y += 56; }
  // Footer: where it's from, and the wordmark.
  ctx.fillStyle = '#c4bcef'; ctx.font = '400 32px system-ui, sans-serif';
  if (title) ctx.fillText(lines(ctx, `From ${title}`, W - 2 * PAD, 1)[0], PAD, bottom + 50);
  ctx.fillStyle = '#f8f4ff'; ctx.font = '800 48px Unbounded, system-ui, sans-serif';
  ctx.fillText('HUB', PAD, H - 120);
  ctx.fillStyle = '#ff5a36'; ctx.fillRect(PAD + ctx.measureText('HUB').width + 8, H - 88, 15, 15);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

export async function shareIdea(k, title, lane = 0) {
  const file = new File([await draw(k, title, lane)], 'hub-key-idea.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: k.point }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function shareButton(k, title, lane = 0) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn-link share', textContent: 'Share as image' });
  b.onclick = async () => {
    b.disabled = true;
    try { await shareIdea(k, title, lane); } catch { b.textContent = "Couldn't share it"; }
    b.disabled = false;
  };
  return b;
}

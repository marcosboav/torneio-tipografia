// Utilitários partilhados pelas páginas.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function toast(message, kind = 'info') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 4000);
}

// Corre fn já e depois de ms em ms, sem sobreposição de pedidos.
export function poll(fn, ms) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  };
  tick();
  const id = setInterval(tick, ms);
  return () => clearInterval(id);
}

export async function resizeImage(file, max, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export const pageUrl = (page) => new URL(page, location.href).href.split('?')[0];

export function qrSvg(text) {
  if (!window.qrcode) return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Segundos que faltam no cronómetro da ronda; null se não foi iniciado.
export function secondsLeft(round) {
  if (!round?.timer_started_at) return null;
  const end = Date.parse(round.timer_started_at) + round.draw_minutes * 60000;
  return Math.max(0, Math.round((end - Date.now()) / 1000));
}

export const votes = (n) => `${n ?? 0} ${n === 1 ? 'voto' : 'votos'}`;

export const fmtTime =(s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name ?? '—';

export function photo(url, alt) {
  return url
    ? `<img class="photo" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
    : `<div class="photo photo-empty"><span>Sem fotografia</span></div>`;
}

export function demoBanner(api) {
  if (api.mode !== 'demo') return;
  const el = document.createElement('div');
  el.className = 'demo-banner';
  el.innerHTML = 'Modo demonstração: os dados ficam só neste browser. Liga o Supabase em <code>js/config.js</code> para usar na aula.';
  document.body.prepend(el);
}

// Assinatura simples do estado, para só redesenhar quando algo muda.
export const signature = (obj) => JSON.stringify(obj);

export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {
    // Sem som disponível.
  }
}

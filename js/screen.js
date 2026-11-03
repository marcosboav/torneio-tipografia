// Ecrã de projeção: letra e cronómetro, duelos em votação, resultados, classificação e campeão.
import { getApi } from './api.js';
import * as L from './logic.js';
import { $, $$, esc, poll, photo, demoBanner, signature, secondsLeft, fmtTime, nameOf, qrSvg, pageUrl, beep, votes } from './ui.js';
import { standingsTable, bracket } from './views.js';

const top = $('#top');
const main = $('#main');

let api;
let tid = new URLSearchParams(location.search).get('t');
let state = null;
let view = 'auto';
let lastSig = '';
let lastMain = '';
let lastTop = '';
let prevStatus = new Map();
let reveal = null;
let lastLeft = null;

async function start() {
  api = await getApi();
  demoBanner(api);
  if (!tid) {
    const list = await api.listTournaments();
    tid = (list.find((t) => t.status !== 'finished') || list[0])?.id;
  }
  if (!tid) {
    main.innerHTML = '<div class="screen-champ"><div class="label">Ainda não há torneios.</div></div>';
    return;
  }
  poll(refresh, 2000);
  setInterval(tick, 500);
  $$('.screen-nav button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'full') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
      return;
    }
    view = b.dataset.view;
    $$('.screen-nav button').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));
}

async function refresh() {
  const s = await api.getPublicState(tid);
  if (!s) return;
  // Um duelo que acabou de fechar fica em destaque uns segundos.
  for (const d of s.duels) {
    if (prevStatus.get(d.id) === 'open' && d.status === 'closed' && d.player_b) reveal = { id: d.id, until: Date.now() + 15000 };
    prevStatus.set(d.id, d.status);
  }
  state = s;
  const sig = signature(s);
  if (sig !== lastSig) {
    lastSig = sig;
    draw();
  }
}

function tick() {
  if (!state) return;
  if (reveal && Date.now() > reveal.until) {
    reveal = null;
    draw();
  }
  const el = $('#screen-timer');
  const round = currentRound();
  if (!el || !round) return;
  const left = secondsLeft(round);
  if (left === 0 && lastLeft > 0) beep();
  lastLeft = left;
  el.classList.toggle('done', left === 0);
  el.textContent = left === null ? fmtTime(round.draw_minutes * 60) : left === 0 ? 'Tempo!' : fmtTime(left);
  el.style.opacity = left === null ? 0.35 : 1;
}

const currentRound = () => L.roundsOf(state).at(-1);

const qrBox = () => `
  <div class="screen-qr">${qrSvg(pageUrl('index.html'))}
    <div class="code-hint">Vota no telemóvel<br><span style="font-weight:500">com o teu código</span></div>
  </div>`;

function setTop(html) {
  if (html !== lastTop) { top.innerHTML = html; lastTop = html; }
}

function setMain(html) {
  if (html !== lastMain) { main.innerHTML = html; lastMain = html; }
}

function draw() {
  if (!state) return;
  const t = state.tournament;
  const round = currentRound();
  const champ = L.champion(state);

  if (view === 'classificacao') {
    setTop(`<div class="screen-title">${esc(t.name)} · <span class="accent">Classificação</span></div>`);
    setMain(`<div class="screen-board">${standingsTable(state)}</div>`);
    return;
  }
  if (view === 'quadro') {
    setTop(`<div class="screen-title">${esc(t.name)} · <span class="accent">Eliminatórias</span></div>`);
    setMain(`<div class="screen-board">${L.roundsOf(state, 'ko').length ? bracket(state) : '<div class="screen-champ"><div class="label">As eliminatórias ainda não começaram.</div></div>'}</div>`);
    return;
  }

  if (champ) {
    setTop(`<div class="screen-title">${esc(t.name)}</div>`);
    setMain(`<div class="screen-champ"><div class="label">Campeão do torneio</div><div class="name">${esc(nameOf(state, champ))}</div></div>`);
    return;
  }

  if (!round) {
    setTop(`<div class="screen-title">${esc(t.name)}</div>${qrBox()}`);
    setMain('<div class="screen-champ"><div class="label">O torneio vai começar</div><div class="name" style="color:#f3f0e8">Aa</div></div>');
    return;
  }

  const title = `${esc(L.roundLabel(state, round))} · Letra <span class="accent">${esc(round.letter)}</span>${round.theme ? ` · ${esc(round.theme)}` : ''}`;
  const duels = L.roundDuels(state, round.id).filter((d) => !L.isBye(d));
  const open = duels.filter((d) => d.status === 'open');

  if (round.status === 'closed') {
    setTop(`<div class="screen-title">${title} · <span class="accent">concluída</span></div>`);
    setMain(`<div class="screen-board">${round.phase === 'swiss' ? standingsTable(state) : bracket(state)}</div>`);
    return;
  }

  const revealed = reveal && state.duels.find((d) => d.id === reveal.id && d.round_id === round.id);
  if (revealed && !open.length) {
    setTop(`<div class="screen-title">${title} · Duelo ${revealed.slot + 1}</div>`);
    setMain(bigDuel(revealed, true));
    return;
  }

  if (open.length === 1) {
    const d = open[0];
    setTop(`<div class="screen-title">${title} · Duelo ${d.slot + 1}<div class="screen-votes">${votes(d.votes_total)}</div></div>${qrBox()}`);
    setMain(bigDuel(d, false));
    return;
  }

  if (open.length > 1) {
    setTop(`<div class="screen-title">${title} · <span class="accent">${open.length} duelos em votação</span></div>${qrBox()}`);
    setMain(`<div class="screen-grid">${open.map((d) => `
      <div class="mini">
        <div class="mini-head"><span>Duelo ${d.slot + 1}</span><span class="screen-votes" style="font-size:16px">${votes(d.votes_total)}</span></div>
        <div class="duel-pair">
          <div class="side">${photo(d.photo_a, 'Desenho A')}<span class="side-tag">A</span></div>
          <div class="side">${photo(d.photo_b, 'Desenho B')}<span class="side-tag">B</span></div>
        </div>
      </div>`).join('')}</div>`);
    return;
  }

  const closed = duels.filter((d) => d.status === 'closed');
  if (closed.length) {
    setTop(`<div class="screen-title">${title} · Resultados</div>`);
    setMain(`<div class="screen-board"><div class="bracket-col" style="gap:10px">${duels.map((d) => d.status === 'closed'
      ? `<div class="match"><div class="${d.winner === d.player_a ? 'w' : 'l'}"><span>${esc(nameOf(state, d.player_a))}</span><span>${d.votes_a}</span></div><div class="${d.winner === d.player_b ? 'w' : 'l'}"><span>${esc(nameOf(state, d.player_b))}</span><span>${d.votes_b}</span></div></div>`
      : `<div class="match"><div class="l">Duelo ${d.slot + 1}: por votar</div></div>`).join('')}</div></div>`);
    return;
  }

  // A desenhar: letra e cronómetro.
  setTop(`<div class="screen-title">${esc(t.name)}</div>`);
  setMain(`
    <div class="screen-draw">
      <div class="screen-letter">${esc(round.letter)}</div>
      <div>
        <div class="screen-title">${esc(L.roundLabel(state, round))}</div>
        ${round.theme ? `<div class="screen-theme">${esc(round.theme)}</div>` : ''}
        <div class="screen-timer" id="screen-timer"></div>
      </div>
    </div>`);
  tick();
}

function bigDuel(d, showNames) {
  const side = (tag, pid, url, n) => {
    const cls = showNames ? (d.winner === pid ? 'win' : 'lose') : '';
    return `
      <div class="side ${cls}">
        ${photo(url, `Desenho ${tag}`)}
        <span class="side-tag">${tag}</span>
        <div class="side-name">${showNames ? `${esc(nameOf(state, pid))} · ${votes(n)}` : '&nbsp;'}</div>
      </div>`;
  };
  return `<div class="screen-duel">${side('A', d.player_a, d.photo_a, d.votes_a)}${side('B', d.player_b, d.photo_b, d.votes_b)}</div>`;
}

start();

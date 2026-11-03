// Página dos alunos: entrar com o código e votar nos duelos abertos.
import { getApi } from './api.js';
import { $, esc, toast, poll, photo, demoBanner, signature } from './ui.js';
import { header } from './views.js';

const CODE_KEY = 'torneio-codigo';
const ERRORS = {
  codigo_invalido: 'Código desconhecido. Confirma com o professor.',
  duelo_invalido: 'Este duelo não pertence ao teu torneio.',
  votacao_fechada: 'A votação deste duelo já fechou.',
  proprio_duelo: 'Não podes votar no teu próprio duelo.',
  escolha_invalida: 'Escolha inválida.',
};

const app = $('#app');
$('#header').innerHTML = header('votar');

let api;
let voter = null;
let ballot = [];
let lastSig = '';
let stopPoll = null;

const readCode = () => { try { return localStorage.getItem(CODE_KEY); } catch { return null; } };
const writeCode = (c) => { try { c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); } catch { /* sem armazenamento */ } };

async function start() {
  api = await getApi();
  demoBanner(api);
  // O QR dos cartões traz o código no endereço: entra logo.
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('codigo');
  if (fromUrl) {
    history.replaceState(null, '', location.pathname);
    if (await login(fromUrl)) return;
  }
  const saved = readCode();
  if (saved && await login(saved, { quiet: true })) return;
  renderLogin();
}

async function login(code, { quiet = false } = {}) {
  const c = code.trim().toUpperCase();
  try {
    const v = await api.voterLogin(c);
    if (!v) {
      if (!quiet) toast(ERRORS.codigo_invalido, 'error');
      writeCode(null);
      return false;
    }
    voter = { ...v, code: c };
    writeCode(c);
    renderBallotShell();
    stopPoll = poll(refresh, 3000);
    return true;
  } catch (err) {
    toast(`Sem ligação: ${err.message}`, 'error');
    return false;
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="card stack" style="margin-top:24px">
      <h1>Entra para votar</h1>
      <p class="muted">Escreve o código que o professor te deu.</p>
      <form id="login-form" class="stack">
        <input id="code" class="code-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="5" placeholder="•••••" required>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
    </div>`;
  $('#code').focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await login($('#code').value);
  });
}

function renderBallotShell() {
  app.innerHTML = `
    <div class="duel-meta" style="margin:8px 0 16px">
      <div><div class="small muted">A votar como</div><h2 style="margin:0">${esc(voter.name)}</h2></div>
      <button class="btn btn-ghost btn-sm" id="logout">Sair</button>
    </div>
    <div id="ballot" class="stack"></div>`;
  $('#logout').addEventListener('click', () => {
    stopPoll?.();
    writeCode(null);
    voter = null;
    lastSig = '';
    renderLogin();
  });
  $('#ballot').addEventListener('click', onVoteClick);
}

async function refresh() {
  ballot = await api.voterBallot(voter.code);
  const sig = signature(ballot);
  if (sig === lastSig) return;
  lastSig = sig;
  renderBallot();
}

function renderBallot() {
  const box = $('#ballot');
  if (!box) return;
  if (!ballot.length) {
    box.innerHTML = `
      <div class="waiting">
        <div class="vote-letter">Aa</div>
        <h2>Ainda não há votações abertas</h2>
        <p class="muted">Esta página atualiza sozinha. Quando o professor abrir um duelo, aparece aqui.</p>
      </div>`;
    return;
  }
  box.innerHTML = ballot.map(card).join('');
}

function card(b) {
  const round = b.phase === 'swiss' ? `Ronda ${b.round_number}` : 'Eliminatórias';
  const side = (tag, url) => b.is_mine
    ? `<div class="side">${photo(url, `Desenho ${tag}`)}<span class="side-tag">${tag}</span></div>`
    : `<button class="vote-btn ${b.my_choice === tag ? 'chosen' : ''}" data-duel="${b.duel_id}" data-choice="${tag}">
         <div class="side">${photo(url, `Desenho ${tag}`)}<span class="side-tag">${tag}</span></div>
         <div class="vote-label">${b.my_choice === tag ? 'O teu voto' : `Votar ${tag}`}</div>
       </button>`;
  let note;
  if (b.is_mine) note = '<span class="chip chip-warn">É o teu duelo: não votas neste</span>';
  else if (b.my_choice) note = `<span class="small muted">Votaste em ${b.my_choice}. Podes mudar até a votação fechar.</span>`;
  else note = '<span class="small muted">Toca no desenho de que gostas mais.</span>';
  return `
    <article class="card vote-card">
      <div class="vote-head">
        <div>
          <span class="chip chip-open chip-dot">Votação aberta</span>
          <div class="small muted" style="margin-top:6px">${round} · Duelo ${b.slot + 1}${b.theme ? ` · ${esc(b.theme)}` : ''}</div>
        </div>
        <div class="vote-letter">${esc(b.letter)}</div>
      </div>
      <div class="duel-pair">${side('A', b.photo_a)}${side('B', b.photo_b)}</div>
      <div style="margin-top:10px">${note}</div>
    </article>`;
}

async function onVoteClick(e) {
  const btn = e.target.closest('.vote-btn');
  if (!btn) return;
  const { duel, choice } = btn.dataset;
  const item = ballot.find((b) => b.duel_id === duel);
  if (item?.my_choice === choice) return;
  try {
    const res = await api.castVote(voter.code, duel, choice);
    if (res !== 'ok') {
      toast(ERRORS[res] || res, 'error');
    } else {
      toast(`Voto registado: ${choice}`, 'ok');
      if (item) item.my_choice = choice;
      lastSig = signature(ballot);
      renderBallot();
    }
  } catch (err) {
    toast(`O voto não foi enviado: ${err.message}`, 'error');
  }
}

start();

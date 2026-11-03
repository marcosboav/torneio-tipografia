// Página do professor: criar torneios, conduzir rondas, carregar fotografias e fechar votações.
import { getApi } from './api.js';
import * as L from './logic.js';
import { $, esc, toast, poll, photo, demoBanner, signature, secondsLeft, fmtTime, nameOf, qrSvg, pageUrl } from './ui.js';
import { header, standingsTable, bracket } from './views.js';

const app = $('#app');
const fileInput = $('#file-input');
$('#header').innerHTML = header('professor');

const TID_KEY = 'torneio-admin-t';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

let api;
let tid = null;
let state = null;
let tab = 'ronda';
let lastSig = '';
let stopPoll = null;
let prep = null;
let uploadTarget = null;
let busy = false;

// Só redesenha o que mudou, para as fotografias não piscarem a cada atualização.
function setHTML(el, html) {
  if (el && el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}

function patchList(container, items) {
  const existing = new Map([...container.children].map((el) => [el.dataset.key, el]));
  items.forEach(({ key, html }, i) => {
    let el = existing.get(key);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = key;
    }
    setHTML(el, html);
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
    existing.delete(key);
  });
  existing.forEach((el) => el.remove());
}

// Arranque e sessão ---------------------------------------------------------

async function start() {
  api = await getApi();
  demoBanner(api);
  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('change', onInput);
  app.addEventListener('submit', onSubmit);
  fileInput.addEventListener('change', onFile);
  setInterval(updateTimer, 1000);
  if (await api.getAdminUser()) enter();
  else renderLogin();
}

function enter() {
  const id = new URLSearchParams(location.search).get('t') || store.get(TID_KEY);
  if (id) openTournament(id);
  else renderList();
}

function renderLogin() {
  app.innerHTML = api.mode === 'demo'
    ? `<div class="card stack wrap-narrow" style="margin:24px auto">
         <h1>Professor</h1>
         <p class="muted">Em modo demonstração não há palavra-passe.</p>
         <button class="btn btn-primary btn-block" data-action="demo-login">Entrar</button>
       </div>`
    : `<form class="card stack wrap-narrow" style="margin:24px auto" data-form="login">
         <h1>Professor</h1>
         <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
         <div class="field"><label for="password">Palavra-passe</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
         <button class="btn btn-primary btn-block" type="submit">Entrar</button>
       </form>`;
}

async function renderList() {
  stopPoll?.();
  tid = null;
  state = null;
  history.replaceState(null, '', location.pathname);
  const list = await api.listTournaments();
  const statusLabel = { swiss: 'Fase suíça', ko: 'Eliminatórias', finished: 'Terminado' };
  app.innerHTML = `
    <div class="duel-meta"><h1 style="margin:0">Torneios</h1><button class="btn btn-ghost btn-sm" data-action="logout">Sair</button></div>
    <div class="stack">
      ${list.length ? `<div class="card"><table><tbody>
        ${list.map((t) => `<tr>
          <td><strong>${esc(t.name)}</strong><div class="small muted">${new Date(t.created_at).toLocaleDateString('pt-PT')}</div></td>
          <td><span class="chip">${statusLabel[t.status] || t.status}</span></td>
          <td class="num"><button class="btn btn-sm" data-action="open-t" data-id="${t.id}">Abrir</button></td>
        </tr>`).join('')}
      </tbody></table></div>` : ''}
      <form class="card stack" data-form="create">
        <h2>Novo torneio</h2>
        <div class="field"><label for="t-name">Nome</label><input id="t-name" name="name" type="text" required placeholder="Torneio de Tipografia · 12.º B"></div>
        <div class="field">
          <label for="t-names">Alunos (um por linha; primeiro nome ou alcunha)</label>
          <textarea id="t-names" name="names" required placeholder="Ana&#10;Bruno&#10;Carla"></textarea>
        </div>
        <div class="fields">
          <div><label for="t-swiss">Rondas suíças</label><input id="t-swiss" name="swiss" type="number" min="1" max="8" value="3"></div>
          <div><label for="t-cut">Apurados para eliminatórias</label>
            <select id="t-cut" name="cut"><option value="8" selected>8</option><option value="4">4</option><option value="16">16</option><option value="0">Sem eliminatórias</option></select></div>
        </div>
        <p class="small muted">O professor é adicionado automaticamente como votante, para o número de votos ser ímpar.</p>
        <button class="btn btn-primary" type="submit">Criar torneio</button>
      </form>
    </div>`;
}

async function openTournament(id) {
  tid = id;
  store.set(TID_KEY, id);
  history.replaceState(null, '', `${location.pathname}?t=${id}`);
  lastSig = '';
  prep = null;
  app.innerHTML = `<div id="t-head"></div><div class="tabs no-print" id="t-tabs"></div><div id="t-body"></div>`;
  stopPoll?.();
  stopPoll = poll(() => refresh(), 3000);
}

async function refresh(force = false) {
  if (!tid) return;
  const s = await api.getAdminState(tid);
  if (!s) {
    toast('Torneio não encontrado.', 'error');
    store.set(TID_KEY, null);
    renderList();
    return;
  }
  state = s;
  const sig = signature(s);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  render();
}

// Desenho -----------------------------------------------------------------

function render() {
  const t = state.tournament;
  setHTML($('#t-head'), `
    <div class="duel-meta">
      <div><div class="small muted">Torneio</div><h1 style="margin:0">${esc(t.name)}</h1></div>
      <div class="btn-row no-print">
        <a class="btn btn-sm" href="ecra.html?t=${t.id}" target="_blank" rel="noopener">Abrir ecrã de projeção</a>
        <a class="btn btn-sm" href="historico.html?t=${t.id}" target="_blank" rel="noopener">Histórico</a>
        <button class="btn btn-sm btn-ghost" data-action="switch">Trocar torneio</button>
      </div>
    </div>`);
  const tabs = [['ronda', 'Ronda'], ['classificacao', 'Classificação'], ['alunos', 'Alunos e códigos'], ['definicoes', 'Definições']];
  setHTML($('#t-tabs'), tabs.map(([k, label]) => `<button class="tab ${tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}">${label}</button>`).join(''));
  const body = $('#t-body');
  if (tab === 'ronda') renderRoundTab(body);
  else {
    body.__layout = null;
    if (tab === 'classificacao') setHTML(body, standingsView());
    if (tab === 'alunos') setHTML(body, playersView());
    if (tab === 'definicoes') setHTML(body, settingsView());
  }
  updateTimer();
}

function renderRoundTab(body) {
  const step = L.nextStep(state);
  if (step.kind !== 'in_progress') {
    body.__layout = null;
    setHTML(body, step.kind === 'finished' ? finishedView() : prepView(step));
    return;
  }
  const round = step.round;
  if (body.__layout !== round.id) {
    body.__html = null;
    body.innerHTML = `<div id="r-hero"></div><div id="r-bulk" style="margin:16px 0"></div><div id="r-duels" class="duel-admin"></div><div id="r-foot" style="margin-top:16px"></div>`;
    body.__layout = round.id;
  }
  const duels = L.roundDuels(state, round.id);
  setHTML($('#r-hero'), heroView(round));
  setHTML($('#r-bulk'), bulkView(duels));
  patchList($('#r-duels'), duels.map((d) => ({ key: d.id, html: duelView(d) })));
  setHTML($('#r-foot'), footView(round, duels));
}

const label = (round) => L.roundLabel(state, round);
const usedLetters = () => state.rounds.map((r) => r.letter);

function stepLabel(step) {
  if (step.kind === 'swiss') return `Ronda ${step.number}`;
  if (step.kind === 'ko_first') return L.koRoundName(L.koSize(state) / 2);
  return L.koRoundName(L.roundDuels(state, step.prev.id).length / 2);
}

function ensurePrep(step) {
  const key = `${step.kind}-${step.number || ''}-${step.prev?.id || ''}`;
  if (prep?.key === key) return;
  const duelCount = step.kind === 'swiss' ? 0 : step.kind === 'ko_first' ? L.koSize(state) / 2 : L.roundDuels(state, step.prev.id).length / 2;
  prep = {
    key,
    letter: L.randomLetter(usedLetters()),
    lower: false,
    theme: '',
    minutes: { 0: 5, 4: 5, 2: 7, 1: 10 }[duelCount] ?? 5,
    pairs: null,
    tiePick: [],
  };
}

function computePairs(step) {
  if (step.kind === 'swiss') {
    if (!prep.pairs) prep.pairs = L.swissPairings(state);
    return { pairs: prep.pairs };
  }
  if (step.kind === 'ko_next') return { pairs: L.nextKoPairs(state, step.prev) };
  const q = L.koQualifiers(state);
  if (!q.tie) return { pairs: L.firstKoPairs(state, q.seeds), q };
  const sure = q.seeds.filter((id) => !q.tie.players.includes(id));
  if (prep.tiePick.length !== q.tie.places) return { pairs: null, q };
  const chosen = new Set([...sure, ...prep.tiePick]);
  const seeds = q.standings.map((r) => r.player.id).filter((id) => chosen.has(id));
  return { pairs: L.firstKoPairs(state, seeds), q };
}

function prepView(step) {
  ensurePrep(step);
  const { pairs, q } = computePairs(step);
  const rank = new Map((q?.standings || []).map((r) => [r.player.id, r.rank]));
  const seedTag = (id) => (rank.has(id) ? ` <span class="small muted">(${rank.get(id)}.º)</span>` : '');
  const tie = q?.tie ? `
    <div class="card" style="background:var(--warn-soft);border-color:#ecd6a8">
      <h3>Empate na linha de corte</h3>
      <p class="small">Estes alunos estão empatados em tudo (vitórias, votos, confronto direto e força dos adversários).
      Há <strong>${q.tie.places}</strong> lugar(es) para eles. Façam um duelo-relâmpago e escolhe quem passa:</p>
      <div class="btn-row">${q.tie.players.map((id) => `
        <label class="check"><input type="checkbox" data-action="tie-pick" data-id="${id}" ${prep.tiePick.includes(id) ? 'checked' : ''}> ${esc(nameOf(state, id))}</label>`).join('')}
      </div>
    </div>` : '';
  const list = pairs ? `
    <ul class="pairs-preview">
      ${pairs.map(([a, b], i) => `<li><span class="small muted">Duelo ${i + 1}</span>
        <strong>${esc(nameOf(state, a))}</strong>${seedTag(a)}
        ${b ? `<span class="vs">vs</span><strong>${esc(nameOf(state, b))}</strong>${seedTag(b)}` : '<span class="chip">folga</span>'}</li>`).join('')}
    </ul>` : '<p class="muted">Escolhe quem passa no empate para ver os duelos.</p>';
  const name = stepLabel(step);
  return `
    <div class="card stack">
      <h2>Preparar: ${esc(name)}</h2>
      <div class="round-hero">
        <div class="round-letter" id="prep-letter-box">${esc(prep.letter) || '?'}</div>
        <div class="stack" style="flex:1;min-width:240px">
          <div class="fields">
            <div><label for="p-letter">Letra</label><input id="p-letter" type="text" maxlength="1" data-bind="letter" value="${esc(prep.letter)}"></div>
            <div><label for="p-min">Minutos para desenhar</label><input id="p-min" type="number" min="1" max="60" data-bind="minutes" value="${prep.minutes}"></div>
          </div>
          <div class="btn-row">
            <button class="btn btn-sm" data-action="roll-letter">Sortear letra</button>
            <label class="check"><input type="checkbox" data-bind="lower" ${prep.lower ? 'checked' : ''}> Incluir minúsculas</label>
          </div>
          <div><label for="p-theme">Restrição ou tema (opcional)</label><input id="p-theme" type="text" data-bind="theme" value="${esc(prep.theme)}" placeholder="ex.: só linhas retas"></div>
        </div>
      </div>
      ${tie}
      <div class="duel-meta" style="margin:0"><h3 style="margin:0">Duelos</h3>
        ${step.kind === 'swiss' ? '<button class="btn btn-sm btn-ghost" data-action="reshuffle">Sortear outra vez</button>' : ''}</div>
      ${list}
      <div><button class="btn btn-accent" data-action="start-round" ${pairs ? '' : 'disabled'}>Começar: ${esc(name)}</button></div>
      ${step.kind === 'swiss' && step.number > 1 ? '<p class="small muted">Emparelhados por número de vitórias, sem repetir adversários.</p>' : ''}
    </div>`;
}

function heroView(round) {
  const started = !!round.timer_started_at;
  return `
    <div class="card"><div class="round-hero">
      <div class="round-letter">${esc(round.letter)}</div>
      <div style="flex:1;min-width:220px">
        <div class="small muted">${esc(label(round))}${round.theme ? ` · ${esc(round.theme)}` : ''}</div>
        <div class="timer" id="timer"></div>
        <div class="btn-row" style="margin-top:10px">
          ${started
            ? `<button class="btn btn-sm" data-action="timer-start">Recomeçar cronómetro</button><button class="btn btn-sm btn-ghost" data-action="timer-stop">Parar</button>`
            : `<button class="btn btn-primary" data-action="timer-start">Iniciar cronómetro (${round.draw_minutes} min)</button>`}
        </div>
      </div>
    </div></div>`;
}

function bulkView(duels) {
  const prof = state.players.find((p) => !p.is_competitor);
  const real = duels.filter((d) => d.player_b);
  const pending = real.filter((d) => d.status === 'pending').length;
  const open = real.filter((d) => d.status === 'open').length;
  return `
    <div class="btn-row">
      <button class="btn btn-sm" data-action="open-all" ${pending ? '' : 'disabled'}>Abrir todas as votações</button>
      <button class="btn btn-sm" data-action="close-all" ${open ? '' : 'disabled'}>Fechar todas</button>
      ${api.mode === 'demo' ? `<button class="btn btn-sm btn-ghost" data-action="simulate" ${open ? '' : 'disabled'}>Simular votos (demo)</button>` : ''}
      ${prof ? `<span class="small muted">O teu código de voto: <strong>${esc(prof.code)}</strong></span>` : ''}
    </div>`;
}

function duelView(d) {
  if (!d.player_b) {
    return `<div class="card"><p class="small muted">Folga</p><p><strong>${esc(nameOf(state, d.player_a))}</strong> passa esta ronda sem duelo e conta como vitória.</p></div>`;
  }
  const voters = state.players.length - 2;
  const closed = d.status === 'closed';
  const chip = { pending: '<span class="chip">Por abrir</span>', open: '<span class="chip chip-open chip-dot">Votação aberta</span>', closed: '<span class="chip chip-closed">Fechada</span>' }[d.status];
  const count = d.status === 'open' ? `<span class="small"><strong>${d.votes_total}</strong>/${voters} votos</span>`
    : closed ? `<span class="small">A ${d.votes_a} · B ${d.votes_b}</span>` : '';
  const side = (tag, pid, url) => `
    <div class="side ${closed && d.winner === pid ? 'win' : ''}">
      ${photo(url, nameOf(state, pid))}
      <span class="side-tag">${tag}</span>
      <div class="side-name"><span>${esc(nameOf(state, pid))}</span>${closed && d.winner === pid ? '<span class="chip chip-closed">vence</span>' : ''}</div>
      <button class="btn btn-sm btn-block upload" data-action="upload" data-duel="${d.id}" data-side="${tag}">${url ? 'Trocar foto' : 'Carregar foto'}</button>
    </div>`;
  let actions = '';
  if (d.status === 'pending') {
    const missing = !d.photo_a || !d.photo_b;
    actions = `<button class="btn btn-accent btn-sm" data-action="open-duel" data-id="${d.id}">Abrir votação</button>${missing ? '<span class="small muted">Faltam fotografias</span>' : ''}`;
  } else if (d.status === 'open') {
    actions = `<button class="btn btn-primary btn-sm" data-action="close-duel" data-id="${d.id}">Fechar votação</button>`;
  } else if (!d.winner) {
    actions = `<span class="chip chip-warn">Empate: quem ganha?</span>
      <button class="btn btn-sm" data-action="pick" data-id="${d.id}" data-winner="${d.player_a}">${esc(nameOf(state, d.player_a))}</button>
      <button class="btn btn-sm" data-action="pick" data-id="${d.id}" data-winner="${d.player_b}">${esc(nameOf(state, d.player_b))}</button>`;
  } else {
    actions = `<button class="btn btn-ghost btn-sm" data-action="reopen" data-id="${d.id}">Reabrir votação</button>`;
  }
  return `
    <div class="card">
      <div class="duel-meta"><strong>Duelo ${d.slot + 1}</strong><span class="btn-row">${count}${chip}</span></div>
      <div class="duel-pair">${side('A', d.player_a, d.photo_a)}${side('B', d.player_b, d.photo_b)}</div>
      <div class="btn-row" style="margin-top:12px">${actions}</div>
    </div>`;
}

function footView(round, duels) {
  const done = duels.every((d) => d.status === 'closed' && d.winner);
  const hasVotes = duels.some((d) => d.votes_total > 0);
  const isFinal = round.phase === 'ko' && duels.length === 1;
  return `
    <div class="btn-row">
      <button class="btn btn-primary" data-action="finish-round" data-id="${round.id}" ${done ? '' : 'disabled'}>${isFinal ? 'Terminar torneio' : `Concluir ${esc(label(round))}`}</button>
      <button class="btn btn-sm btn-danger" data-action="cancel-round" data-id="${round.id}" ${hasVotes ? 'disabled' : ''}>Anular ronda</button>
      <span class="small muted">${done ? 'Todos os duelos têm vencedor.' : 'Fecha todos os duelos para concluir.'}${hasVotes ? '' : ' Podes anular enquanto não houver votos.'}</span>
    </div>`;
}

function finishedView() {
  const champ = L.champion(state);
  return `
    <div class="stack">
      ${champ ? `<div class="champion"><div class="small">Campeão do torneio</div><div class="name">${esc(nameOf(state, champ))}</div></div>`
        : '<div class="card"><h2>Torneio terminado</h2></div>'}
      ${L.roundsOf(state, 'ko').length ? `<div class="card"><h2>Eliminatórias</h2>${bracket(state)}</div>` : ''}
      <div class="card"><h2>Classificação da fase suíça</h2>${standingsTable(state)}</div>
    </div>`;
}

function standingsView() {
  return `
    <div class="stack">
      <div class="card"><h2>Classificação da fase suíça</h2>${standingsTable(state)}</div>
      ${L.roundsOf(state, 'ko').length ? `<div class="card"><h2>Eliminatórias</h2>${bracket(state)}</div>` : ''}
    </div>`;
}

function playersView() {
  const started = state.rounds.length > 0;
  const people = [...state.players].sort((a, b) => (b.is_competitor - a.is_competitor) || a.name.localeCompare(b.name, 'pt'));
  const voteUrl = pageUrl('index.html');
  return `
    <div class="stack">
      <div class="card no-print">
        <div class="duel-meta"><h2 style="margin:0">Alunos</h2><button class="btn btn-sm" data-action="print">Imprimir cartões</button></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Nome</th><th>Código</th><th>Papel</th><th></th></tr></thead>
          <tbody>${people.map((p) => `<tr>
            <td>${esc(p.name)}</td><td><code>${esc(p.code)}</code></td>
            <td class="small muted">${p.is_competitor ? 'Concorrente' : 'Só vota'}</td>
            <td class="num"><button class="btn btn-sm btn-ghost" data-action="rename" data-id="${p.id}">Renomear</button>
              ${started ? '' : `<button class="btn btn-sm btn-ghost" data-action="remove-player" data-id="${p.id}">Remover</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${started ? '<p class="small muted" style="margin-top:10px">O torneio já começou: já não se podem adicionar nem remover concorrentes.</p>' : `
          <form class="btn-row" data-form="add-player" style="margin-top:12px">
            <input name="name" type="text" placeholder="Nome do aluno" required style="flex:1;min-width:160px">
            <button class="btn btn-sm" type="submit">Adicionar</button>
          </form>`}
        <p class="small muted" style="margin-top:10px">Os alunos votam em <strong>${esc(voteUrl)}</strong>. O QR de cada cartão já traz o código.</p>
      </div>
      <div class="codes">
        ${people.map((p) => `
          <div class="code-card">
            <div class="small muted">Torneio de Tipografia</div>
            <h3 style="margin:6px 0 0">${esc(p.name)}</h3>
            <div class="code">${esc(p.code)}</div>
            ${qrSvg(`${voteUrl}?codigo=${p.code}`)}
          </div>`).join('')}
      </div>
    </div>`;
}

function settingsView() {
  const t = state.tournament;
  return `
    <div class="stack">
      <form class="card stack" data-form="settings">
        <h2>Definições</h2>
        <div class="field"><label for="s-name">Nome</label><input id="s-name" name="name" type="text" value="${esc(t.name)}" required></div>
        <div class="fields">
          <div><label for="s-swiss">Rondas suíças</label><input id="s-swiss" name="swiss" type="number" min="1" max="8" value="${t.swiss_rounds}"></div>
          <div><label for="s-cut">Apurados para eliminatórias</label>
            <select id="s-cut" name="cut">${[8, 4, 16, 0].map((n) => `<option value="${n}" ${t.cut_size === n ? 'selected' : ''}>${n || 'Sem eliminatórias'}</option>`).join('')}</select></div>
        </div>
        <div><button class="btn btn-primary" type="submit">Guardar</button></div>
      </form>
      <div class="card">
        <h2>Apagar torneio</h2>
        <p class="muted">Apaga o torneio, os votos e as fotografias. Não dá para desfazer.</p>
        <button class="btn btn-danger" data-action="delete-t">Apagar este torneio</button>
      </div>
    </div>`;
}

function updateTimer() {
  const el = $('#timer');
  if (!el || !state) return;
  const round = L.nextStep(state).round;
  if (!round) return;
  const left = secondsLeft(round);
  el.classList.toggle('done', left === 0);
  el.textContent = left === null ? fmtTime(round.draw_minutes * 60) : left === 0 ? 'Tempo!' : fmtTime(left);
  el.style.opacity = left === null ? 0.35 : 1;
}

// Ações ---------------------------------------------------------------------

async function act(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
    await refresh(true);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Algo correu mal.', 'error');
  } finally {
    busy = false;
  }
}

async function closeDuel(id) {
  const fresh = await api.getAdminState(tid);
  const d = fresh.duels.find((x) => x.id === id);
  if (!d || d.status !== 'open') return;
  const winner = L.winnerByVotes(d);
  await api.updateDuel(id, { status: 'closed', winner });
  if (!winner) toast(`Duelo ${d.slot + 1} empatado: escolhe o vencedor.`);
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const step = state ? L.nextStep(state) : null;
  switch (action) {
    case 'demo-login':
      await api.adminLogin();
      enter();
      break;
    case 'logout':
      await api.adminLogout();
      store.set(TID_KEY, null);
      renderLogin();
      break;
    case 'open-t':
      openTournament(id);
      break;
    case 'switch':
      store.set(TID_KEY, null);
      renderList();
      break;
    case 'tab':
      tab = el.dataset.tab;
      render();
      break;
    case 'roll-letter':
      prep.letter = L.randomLetter(usedLetters(), { lower: prep.lower });
      render();
      break;
    case 'reshuffle':
      prep.pairs = L.swissPairings(state);
      render();
      break;
    case 'tie-pick': {
      const pid = el.dataset.id;
      prep.tiePick = el.checked ? [...prep.tiePick, pid] : prep.tiePick.filter((x) => x !== pid);
      render();
      break;
    }
    case 'start-round': {
      const letter = prep.letter.trim();
      if (!letter) return toast('Escolhe uma letra.', 'error');
      const { pairs } = computePairs(step);
      await act(async () => {
        await api.createRound(tid, {
          number: state.rounds.length + 1,
          phase: step.kind === 'swiss' ? 'swiss' : 'ko',
          letter,
          theme: prep.theme.trim() || null,
          draw_minutes: Math.max(1, Number(prep.minutes) || 5),
        }, L.assignSides(pairs));
        if (step.kind === 'ko_first') await api.updateTournament(tid, { status: 'ko' });
        prep = null;
      });
      break;
    }
    case 'timer-start':
      await act(() => api.updateRound(step.round.id, { timer_started_at: new Date().toISOString() }));
      break;
    case 'timer-stop':
      await act(() => api.updateRound(step.round.id, { timer_started_at: null }));
      break;
    case 'open-duel':
      await act(() => api.updateDuel(id, { status: 'open' }));
      break;
    case 'close-duel':
      await act(() => closeDuel(id));
      break;
    case 'reopen':
      await act(() => api.updateDuel(id, { status: 'open', winner: null }));
      break;
    case 'pick':
      await act(() => api.updateDuel(id, { winner: el.dataset.winner }));
      break;
    case 'open-all':
      await act(async () => {
        for (const d of L.roundDuels(state, step.round.id)) {
          if (d.player_b && d.status === 'pending') await api.updateDuel(d.id, { status: 'open' });
        }
      });
      break;
    case 'close-all':
      await act(async () => {
        for (const d of L.roundDuels(state, step.round.id)) if (d.status === 'open') await closeDuel(d.id);
      });
      break;
    case 'simulate':
      await act(() => api.simulateVotes(tid));
      break;
    case 'finish-round': {
      const duels = L.roundDuels(state, id);
      const round = state.rounds.find((r) => r.id === id);
      await act(async () => {
        await api.updateRound(id, { status: 'closed' });
        const swissOver = round.phase === 'swiss' && round.number >= state.tournament.swiss_rounds && state.tournament.cut_size === 0;
        if ((round.phase === 'ko' && duels.length === 1) || swissOver) await api.updateTournament(tid, { status: 'finished' });
      });
      break;
    }
    case 'cancel-round':
      if (!confirm('Anular esta ronda? Os duelos e as fotografias desta ronda são apagados.')) return;
      await act(() => api.deleteRound(id));
      break;
    case 'upload':
      uploadTarget = { duel: el.dataset.duel, side: el.dataset.side };
      fileInput.value = '';
      fileInput.click();
      break;
    case 'print':
      window.print();
      break;
    case 'rename': {
      const p = state.players.find((x) => x.id === id);
      const name = prompt('Novo nome:', p.name);
      if (name && name.trim()) await act(() => api.updatePlayer(id, { name: name.trim() }));
      break;
    }
    case 'remove-player':
      if (!confirm('Remover este aluno?')) return;
      await act(() => api.deletePlayer(id));
      break;
    case 'delete-t':
      if (!confirm(`Apagar "${state.tournament.name}"? Não dá para desfazer.`)) return;
      try {
        await api.deleteTournament(tid);
        store.set(TID_KEY, null);
        toast('Torneio apagado.');
        renderList();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    default:
  }
}

function onInput(e) {
  const bind = e.target.dataset?.bind;
  if (!bind || !prep) return;
  prep[bind] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (bind === 'letter') $('#prep-letter-box').textContent = prep.letter || '?';
}

async function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  switch (form.dataset.form) {
    case 'login':
      try {
        await api.adminLogin(data.get('email'), data.get('password'));
        enter();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'create': {
      const names = String(data.get('names')).split('\n').map((s) => s.trim()).filter(Boolean);
      if (names.length < 2) return toast('Precisas de pelo menos 2 alunos.', 'error');
      if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return toast('Há nomes repetidos. Usa alcunhas diferentes.', 'error');
      try {
        const id = await api.createTournament({
          name: String(data.get('name')).trim(),
          swiss_rounds: Math.max(1, Number(data.get('swiss')) || 3),
          cut_size: Number(data.get('cut')),
          names,
        });
        tab = 'alunos';
        openTournament(id);
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'add-player':
      await act(() => api.addPlayer(tid, String(data.get('name')).trim()));
      break;
    case 'settings':
      await act(async () => {
        await api.updateTournament(tid, {
          name: String(data.get('name')).trim(),
          swiss_rounds: Math.max(1, Number(data.get('swiss')) || 3),
          cut_size: Number(data.get('cut')),
        });
        toast('Guardado.', 'ok');
      });
      break;
    default:
  }
}

async function onFile() {
  const file = fileInput.files[0];
  if (!file || !uploadTarget) return;
  const { duel, side } = uploadTarget;
  uploadTarget = null;
  toast('A carregar fotografia…');
  await act(() => api.uploadPhoto(tid, duel, side, file));
}

start();

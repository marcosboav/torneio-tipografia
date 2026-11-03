// Histórico: todos os torneios, rondas e desenhos, com filtro por aluno.
import { getApi } from './api.js';
import * as L from './logic.js';
import { $, esc, demoBanner, nameOf, votes } from './ui.js';
import { header, standingsTable, bracket, duelCard } from './views.js';

const app = $('#app');
$('#header').innerHTML = header('historico');

let api;
let list = [];
let state = null;
let filter = '';
let tab = 'duelos';

async function start() {
  api = await getApi();
  demoBanner(api);
  list = await api.listTournaments();
  if (!list.length) {
    app.innerHTML = '<div class="card"><h1>Histórico</h1><p class="muted">Ainda não há torneios.</p></div>';
    return;
  }
  const wanted = new URLSearchParams(location.search).get('t');
  await load(list.some((t) => t.id === wanted) ? wanted : list[0].id);
  app.addEventListener('change', async (e) => {
    if (e.target.id === 'h-tournament') {
      filter = '';
      await load(e.target.value);
    }
    if (e.target.id === 'h-player') {
      filter = e.target.value;
      render();
    }
  });
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
  });
}

async function load(id) {
  state = await api.getPublicState(id);
  history.replaceState(null, '', `${location.pathname}?t=${id}`);
  render();
}

function render() {
  const t = state.tournament;
  const champ = L.champion(state);
  const people = L.competitors(state).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  const rounds = L.roundsOf(state);
  const lettersUsed = rounds.map((r) => r.letter).join(' ');

  const roundBlocks = rounds.map((r) => {
    let duels = L.roundDuels(state, r.id);
    if (filter) duels = duels.filter((d) => d.player_a === filter || d.player_b === filter);
    if (!duels.length) return '';
    return `
      <section class="round-block">
        <div class="round-title">
          <span class="letter">${esc(r.letter)}</span>
          <div><h2 style="margin:0">${esc(L.roundLabel(state, r))}</h2>${r.theme ? `<div class="muted small">${esc(r.theme)}</div>` : ''}</div>
        </div>
        <div class="gallery">${duels.map((d) => duelCard(state, d)).join('')}</div>
      </section>`;
  }).join('');

  const record = filter ? L.computeStandings(state).find((r) => r.player.id === filter) : null;

  app.innerHTML = `
    <div class="stack">
      <div class="fields">
        <div><label for="h-tournament">Torneio</label>
          <select id="h-tournament">${list.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div><label for="h-player">Aluno</label>
          <select id="h-player"><option value="">Todos</option>${people.map((p) => `<option value="${p.id}" ${p.id === filter ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <div>
        <h1 style="margin-bottom:4px">${esc(t.name)}</h1>
        <p class="muted">${new Date(t.created_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}
          · ${people.length} alunos · ${rounds.length} rondas${lettersUsed ? ` · letras ${esc(lettersUsed)}` : ''}</p>
      </div>
      ${champ ? `<div class="champion"><div class="small">Campeão</div><div class="name">${esc(nameOf(state, champ))}</div></div>` : ''}
      <div class="tabs">
        <button class="tab ${tab === 'duelos' ? 'active' : ''}" data-tab="duelos">Desenhos</button>
        <button class="tab ${tab === 'classificacao' ? 'active' : ''}" data-tab="classificacao">Classificação</button>
      </div>
      ${tab === 'duelos'
        ? `${record ? `<div class="card"><strong>${esc(record.player.name)}</strong>: ${record.wins} ${record.wins === 1 ? 'vitória' : 'vitórias'}, ${record.losses} ${record.losses === 1 ? 'derrota' : 'derrotas'}, ${votes(record.votesFor)} recebidos na fase suíça (${record.rank}.º lugar).</div>` : ''}
           ${roundBlocks || '<p class="muted">Ainda não há duelos.</p>'}`
        : `<div class="card"><h2>Fase suíça</h2>${standingsTable(state)}</div>
           ${L.roundsOf(state, 'ko').length ? `<div class="card"><h2>Eliminatórias</h2>${bracket(state)}</div>` : ''}`}
    </div>`;
}

start();

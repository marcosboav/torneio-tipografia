// Componentes de HTML partilhados: classificação, quadro e cartão de duelo.
import * as L from './logic.js';
import { esc, nameOf, photo, votes } from './ui.js';

export function standingsTable(state) {
  const rows = L.computeStandings(state);
  const size = L.koSize(state);
  const ko = state.tournament.cut_size > 0;
  return `
    <div class="table-scroll"><table>
      <thead><tr>
        <th class="num">#</th><th>Aluno</th><th class="num">V</th><th class="num">D</th>
        <th class="num" title="Votos recebidos">Votos</th><th class="num" title="Soma das vitórias dos adversários">Força adv.</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr class="${ko && r.rank === size ? 'cut' : ''} ${ko && r.rank > size ? 'out' : ''}">
            <td class="num">${r.rank}</td>
            <td>${esc(r.player.name)}${r.byes ? ' <span class="chip">folga</span>' : ''}</td>
            <td class="num">${r.wins}</td><td class="num">${r.losses}</td>
            <td class="num">${r.votesFor}</td><td class="num">${r.oppWins}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>
    ${ko ? `<p class="small muted" style="margin-top:8px">Desempate: vitórias, votos recebidos, confronto direto, força dos adversários. Os ${size} primeiros passam às eliminatórias.</p>` : ''}`;
}

export function bracket(state) {
  const size = L.koSize(state);
  if (size < 2) return '';
  const koRounds = L.roundsOf(state, 'ko');
  const cols = [];
  for (let n = size / 2, i = 0; n >= 1; n /= 2, i++) {
    const round = koRounds.at(i);
    const duels = round ? L.roundDuels(state, round.id) : [];
    const matches = Array.from({ length: n }, (_, slot) => {
      const d = duels.find((x) => x.slot === slot);
      if (!d) return '<div class="match"><div class="l">—</div><div class="l">—</div></div>';
      if (d.status !== 'closed') {
        return `<div class="match"><div class="l">${d.status === 'open' ? 'Em votação' : 'Por disputar'}</div><div class="l">${round ? `Letra ${esc(round.letter)}` : ''}</div></div>`;
      }
      const line = (pid, votes) => `<div class="${d.winner === pid ? 'w' : 'l'}"><span>${esc(nameOf(state, pid))}</span><span>${votes ?? ''}</span></div>`;
      return `<div class="match">${line(d.player_a, d.votes_a)}${line(d.player_b, d.votes_b)}</div>`;
    });
    cols.push(`<div class="bracket-col"><h3>${L.koRoundName(n)}${round ? ` · ${esc(round.letter)}` : ''}</h3>${matches.join('')}</div>`);
  }
  return `<div class="bracket">${cols.join('')}</div>`;
}

// Cartão de um duelo já mostrado ao público (histórico).
export function duelCard(state, duel) {
  if (L.isBye(duel)) {
    return `<div class="card"><p class="muted small">Folga</p><p><strong>${esc(nameOf(state, duel.player_a))}</strong> passou esta ronda sem duelo.</p></div>`;
  }
  const closed = duel.status === 'closed';
  const side = (tag, pid, url, n) => `
    <div class="side ${closed && duel.winner === pid ? 'win' : ''}">
      ${photo(url, closed ? nameOf(state, pid) : `Desenho ${tag}`)}
      <span class="side-tag">${tag}</span>
      <div class="side-name"><span>${closed ? esc(nameOf(state, pid)) : '?'}</span><span class="muted">${closed ? votes(n) : ''}</span></div>
    </div>`;
  return `
    <div class="card">
      <div class="duel-meta">
        <span class="small muted">Duelo ${duel.slot + 1}</span>
        ${closed ? '' : `<span class="chip ${duel.status === 'open' ? 'chip-open' : ''} chip-dot">${duel.status === 'open' ? 'Em votação' : 'Por votar'}</span>`}
      </div>
      <div class="duel-pair">${side('A', duel.player_a, duel.photo_a, duel.votes_a)}${side('B', duel.player_b, duel.photo_b, duel.votes_b)}</div>
    </div>`;
}

export function header(active) {
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `
    <header class="site-header">
      <a class="brand" href="index.html"><span class="brand-mark">Aa</span>Torneio de Tipografia</a>
      <nav class="nav">
        ${link('index.html', 'Votar', 'votar')}
        ${link('historico.html', 'Histórico', 'historico')}
        ${link('ecra.html', 'Ecrã', 'ecra')}
        ${link('professor.html', 'Professor', 'professor')}
      </nav>
    </header>`;
}

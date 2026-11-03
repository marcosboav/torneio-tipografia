// Regras do torneio: classificação, emparelhamentos suíços e eliminatórias.
// Funções puras sobre o "state": { tournament, players, rounds, duels }.

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');

export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomLetter(used = [], { lower = false } = {}, rng = Math.random) {
  const pool = lower ? [...UPPER, ...LOWER] : UPPER;
  const fresh = pool.filter((l) => !used.includes(l));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rng() * from.length)];
}

export const competitors = (state) => state.players.filter((p) => p.is_competitor);

// Folga: duelo fechado sem segundo aluno. (Nas páginas públicas os nomes de um
// duelo por fechar estão escondidos, por isso player_b vazio não chega.)
export const isBye = (d) => d.status === 'closed' && !d.player_b;

export const roundDuels = (state, roundId) =>
  state.duels.filter((d) => d.round_id === roundId).sort((a, b) => a.slot - b.slot);

export const roundsOf = (state, phase) =>
  state.rounds.filter((r) => !phase || r.phase === phase).sort((a, b) => a.number - b.number);

// Classificação da fase suíça: vitórias, depois votos recebidos, depois confronto direto.
export function computeStandings(state) {
  const recs = new Map();
  for (const p of competitors(state)) {
    recs.set(p.id, { player: p, wins: 0, losses: 0, votesFor: 0, votesAgainst: 0, byes: 0, played: 0, results: new Map() });
  }
  const swissIds = new Set(roundsOf(state, 'swiss').map((r) => r.id));
  for (const d of state.duels) {
    if (!swissIds.has(d.round_id) || d.status !== 'closed') continue;
    const a = recs.get(d.player_a);
    const b = recs.get(d.player_b);
    if (a && !d.player_b) {
      a.wins++;
      a.byes++;
      continue;
    }
    if (!a || !b) continue;
    const va = d.votes_a || 0;
    const vb = d.votes_b || 0;
    a.votesFor += va; a.votesAgainst += vb; a.played++;
    b.votesFor += vb; b.votesAgainst += va; b.played++;
    if (d.winner === a.player.id) {
      a.wins++; b.losses++;
      a.results.set(b.player.id, 'W'); b.results.set(a.player.id, 'L');
    } else if (d.winner === b.player.id) {
      b.wins++; a.losses++;
      b.results.set(a.player.id, 'W'); a.results.set(b.player.id, 'L');
    } else {
      a.results.set(b.player.id, '?'); b.results.set(a.player.id, '?');
    }
  }
  // Força dos adversários: soma das vitórias de quem se defrontou.
  for (const r of recs.values()) {
    r.oppWins = [...r.results.keys()].reduce((sum, id) => sum + (recs.get(id)?.wins || 0), 0);
  }
  const list = [...recs.values()].sort(compareRecords);
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// Critérios: vitórias, votos recebidos, confronto direto, força dos adversários.
function compareRecords(a, b) {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.votesFor !== a.votesFor) return b.votesFor - a.votesFor;
  const h2h = a.results.get(b.player.id);
  if (h2h === 'W') return -1;
  if (h2h === 'L') return 1;
  if (b.oppWins !== a.oppWins) return b.oppWins - a.oppWins;
  return a.player.name.localeCompare(b.player.name, 'pt');
}

// Dois registos que nenhum critério separa (o nome não conta como desempate).
export function stillTied(a, b) {
  if (!a || !b) return false;
  if (a.wins !== b.wins || a.votesFor !== b.votesFor || a.oppWins !== b.oppWins) return false;
  const h2h = a.results.get(b.player.id);
  return h2h !== 'W' && h2h !== 'L';
}

// Emparelhamentos da próxima ronda suíça. Devolve [[idA, idB|null], ...].
export function swissPairings(state, rng = Math.random) {
  const standings = computeStandings(state);
  const firstRound = roundsOf(state, 'swiss').length === 0;
  let order;
  if (firstRound) {
    order = shuffle(standings, rng);
  } else {
    // Ordenar por vitórias; dentro do mesmo número de vitórias, ordem aleatória.
    const byWins = new Map();
    for (const r of standings) {
      if (!byWins.has(r.wins)) byWins.set(r.wins, []);
      byWins.get(r.wins).push(r);
    }
    order = [...byWins.keys()].sort((x, y) => y - x).flatMap((w) => shuffle(byWins.get(w), rng));
  }

  const pairs = [];
  if (order.length % 2 === 1) {
    // Folga para o último classificado que ainda não teve folga.
    const pool = [...order].reverse();
    const bye = pool.find((r) => r.byes === 0) || pool[0];
    order = order.filter((r) => r !== bye);
    pairs.push([bye.player.id, null]);
  }

  const played = (x, y) => x.results.has(y.player.id);
  const solve = (list) => {
    if (list.length === 0) return [];
    const [p, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      if (played(p, rest[i])) continue;
      const tail = solve(rest.filter((_, j) => j !== i));
      if (tail) return [[p.player.id, rest[i].player.id], ...tail];
    }
    return null;
  };
  let main = solve(order);
  if (!main) {
    // Sem solução sem repetições: emparelhar pela ordem.
    main = [];
    for (let i = 0; i < order.length; i += 2) main.push([order[i].player.id, order[i + 1].player.id]);
  }
  return [...main, ...pairs];
}

// Ordem das cabeças de série no quadro: 8 → [1,8,4,5,2,7,3,6].
export function bracketOrder(n) {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

export function koSize(state) {
  const n = competitors(state).length;
  let size = 1;
  while (size * 2 <= Math.min(n, state.tournament.cut_size)) size *= 2;
  return size;
}

// Apurados para as eliminatórias + empate na linha de corte, se existir.
export function koQualifiers(state) {
  const standings = computeStandings(state);
  const size = koSize(state);
  const last = standings[size - 1];
  const next = standings[size];
  let tie = null;
  if (stillTied(last, next)) {
    const group = standings.filter((r) => r === last || stillTied(r, last));
    tie = { places: group.filter((r) => r.rank <= size).length, players: group.map((r) => r.player.id) };
  }
  return { standings, size, seeds: standings.slice(0, size).map((r) => r.player.id), tie };
}

// Primeira eliminatória: 1–8, 4–5, 2–7, 3–6, evitando repetir duelos da fase suíça.
export function firstKoPairs(state, seeds) {
  const standings = computeStandings(state);
  const recById = new Map(standings.map((r) => [r.player.id, r]));
  const played = (x, y) => recById.get(x)?.results.has(y);
  const order = bracketOrder(seeds.length);
  const pairs = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([seeds[order[i] - 1], seeds[order[i + 1] - 1]]);
  for (let i = 0; i < pairs.length; i++) {
    if (!played(pairs[i][0], pairs[i][1])) continue;
    const j = i % 2 === 0 ? i + 1 : i - 1;
    if (!pairs[j]) continue;
    if (!played(pairs[i][0], pairs[j][1]) && !played(pairs[j][0], pairs[i][1])) {
      [pairs[i][1], pairs[j][1]] = [pairs[j][1], pairs[i][1]];
    }
  }
  return pairs;
}

// Eliminatória seguinte: vencedores dos duelos 1+2, 3+4, ...
export function nextKoPairs(state, prevRound) {
  const winners = roundDuels(state, prevRound.id).map((d) => d.winner);
  const pairs = [];
  for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]]);
  return pairs;
}

// Sorteia o lado A/B de cada duelo, para que a votação seja anónima.
export function assignSides(pairs, rng = Math.random) {
  return pairs.map(([x, y]) => (y && rng() < 0.5 ? [y, x] : [x, y]));
}

export function koRoundName(duelCount) {
  return { 1: 'Final', 2: 'Meias-finais', 4: 'Quartos de final', 8: 'Oitavos de final' }[duelCount] || 'Eliminatória';
}

export function roundLabel(state, round) {
  if (round.phase === 'swiss') return `Ronda ${round.number}`;
  return koRoundName(roundDuels(state, round.id).length);
}

// O que o professor pode fazer a seguir.
export function nextStep(state) {
  const rounds = roundsOf(state);
  const last = rounds.at(-1);
  if (last && last.status !== 'closed') return { kind: 'in_progress', round: last };
  const swissDone = roundsOf(state, 'swiss').length;
  if (swissDone < state.tournament.swiss_rounds) return { kind: 'swiss', number: swissDone + 1 };
  const ko = roundsOf(state, 'ko');
  if (ko.length === 0) return koSize(state) >= 2 ? { kind: 'ko_first' } : { kind: 'finished' };
  const lastKo = ko.at(-1);
  if (roundDuels(state, lastKo.id).length <= 1) return { kind: 'finished' };
  return { kind: 'ko_next', prev: lastKo };
}

export function champion(state) {
  const ko = roundsOf(state, 'ko');
  const last = ko.at(-1);
  if (!last || last.status !== 'closed') return null;
  const duels = roundDuels(state, last.id);
  return duels.length === 1 ? duels[0].winner : null;
}

// Vencedor pela contagem; null em caso de empate.
export function winnerByVotes(duel) {
  if (!duel.player_b) return duel.player_a;
  if ((duel.votes_a || 0) > (duel.votes_b || 0)) return duel.player_a;
  if ((duel.votes_b || 0) > (duel.votes_a || 0)) return duel.player_b;
  return null;
}

// Códigos de votação sem caracteres ambíguos (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

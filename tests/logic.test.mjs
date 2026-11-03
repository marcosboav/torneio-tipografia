// Simula torneios completos com votos aleatórios e verifica as regras.
// Correr: node tests/logic.test.mjs
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function simulate(nPlayers, seed) {
  const rng = seeded(seed);
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: `p${i}`, name: `Aluno ${i}`, is_competitor: true }));
  players.push({ id: 'prof', name: 'Professor', is_competitor: false });
  const state = { tournament: { swiss_rounds: 3, cut_size: 8 }, players, rounds: [], duels: [] };
  const voters = players.length;
  let n = 0;

  const playRound = (phase, pairs) => {
    const round = { id: `r${++n}`, number: n, phase, status: 'open' };
    state.rounds.push(round);
    L.assignSides(pairs, rng).forEach(([a, b], slot) => {
      const d = { id: `${round.id}d${slot}`, round_id: round.id, slot, player_a: a, player_b: b, status: 'closed' };
      if (b) {
        // Todos votam menos os dois do duelo: número ímpar de votos.
        const total = voters - 2;
        d.votes_a = Math.floor(rng() * (total + 1));
        d.votes_b = total - d.votes_a;
      }
      d.winner = L.winnerByVotes(d);
      if (voters % 2 === 1) assert.ok(d.winner, 'nunca há empate com número ímpar de votos');
      // Empate (número par de votos): o professor escolhe.
      if (!d.winner) d.winner = rng() < 0.5 ? a : b;
      state.duels.push(d);
    });
    round.status = 'closed';
    return round;
  };

  for (;;) {
    const step = L.nextStep(state);
    if (step.kind === 'swiss') playRound('swiss', L.swissPairings(state, rng));
    else if (step.kind === 'ko_first') {
      const q = L.koQualifiers(state);
      playRound('ko', L.firstKoPairs(state, q.seeds));
    } else if (step.kind === 'ko_next') playRound('ko', L.nextKoPairs(state, step.prev));
    else break;
  }
  return state;
}

let ties = 0;
for (let seed = 1; seed <= 500; seed++) {
  const state = simulate(18, seed);
  const swiss = L.roundsOf(state, 'swiss');
  const ko = L.roundsOf(state, 'ko');
  assert.equal(swiss.length, 3);
  assert.deepEqual(ko.map((r) => L.roundDuels(state, r.id).length), [4, 2, 1]);

  // Fase suíça: todos jogam 3 vezes, sem repetir adversário.
  const seen = new Set();
  const games = new Map();
  for (const r of swiss) {
    for (const d of L.roundDuels(state, r.id)) {
      const key = [d.player_a, d.player_b].sort().join('-');
      assert.ok(!seen.has(key), `repetição na fase suíça (seed ${seed})`);
      seen.add(key);
      for (const p of [d.player_a, d.player_b]) games.set(p, (games.get(p) || 0) + 1);
    }
  }
  assert.equal(games.size, 18);
  for (const g of games.values()) assert.equal(g, 3);

  // Os apurados são os 8 primeiros da classificação.
  const standings = L.computeStandings({ ...state, rounds: swiss, duels: state.duels.filter((d) => swiss.some((r) => r.id === d.round_id)) });
  const top8 = new Set(standings.slice(0, 8).map((r) => r.player.id));
  const qf = L.roundDuels(state, ko[0].id).flatMap((d) => [d.player_a, d.player_b]);
  assert.deepEqual(new Set(qf), top8);
  if (L.stillTied(standings[7], standings[8])) ties++;

  assert.ok(L.champion(state), 'há campeão');
}
console.log(`18 alunos: 500 torneios simulados sem erros (empates na linha de corte: ${ties})`);

// Número ímpar: há folga, ninguém tem duas folgas.
for (let seed = 1; seed <= 200; seed++) {
  const state = simulate(17, seed);
  const byes = state.duels.filter((d) => !d.player_b).map((d) => d.player_a);
  assert.equal(byes.length, 3);
  assert.equal(new Set(byes).size, 3);
  assert.ok(L.champion(state));
}
console.log('17 alunos: 200 torneios simulados, folgas corretas');

assert.deepEqual(L.bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
assert.deepEqual(L.bracketOrder(4), [1, 4, 2, 3]);
assert.equal(L.koRoundName(4), 'Quartos de final');
console.log('Quadro e nomes das eliminatórias corretos');

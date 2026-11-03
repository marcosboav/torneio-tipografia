// Modo demonstração: guarda tudo no localStorage deste browser.
// Imita as regras do Supabase (ver supabase/schema.sql) para se poder testar sem servidor.
import { makeCode } from './logic.js';
import { resizeImage, blobToDataURL } from './ui.js';

const KEY = 'torneio-demo-v1';

const empty = () => ({ tournaments: [], players: [], rounds: [], duels: [], votes: [] });

function load() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return empty();
  }
}

function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new Error('O armazenamento do modo demonstração está cheio. Apaga um torneio de teste.');
  }
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const now = () => new Date().toISOString();
const norm = (code) => String(code || '').trim().toUpperCase();

function counts(db, duelId) {
  const vs = db.votes.filter((v) => v.duel_id === duelId);
  return {
    votes_a: vs.filter((v) => v.choice === 'A').length,
    votes_b: vs.filter((v) => v.choice === 'B').length,
    votes_total: vs.length,
  };
}

function fullState(db, tid) {
  const tournament = db.tournaments.find((t) => t.id === tid);
  if (!tournament) return null;
  return {
    tournament,
    players: db.players.filter((p) => p.tournament_id === tid),
    rounds: db.rounds.filter((r) => r.tournament_id === tid),
    duels: db.duels.filter((d) => d.tournament_id === tid).map((d) => ({ ...d, ...counts(db, d.id) })),
  };
}

// Igual à vista v_duels: nomes, vencedor e votos só depois de fechar.
function maskDuel(d) {
  const closed = d.status === 'closed';
  return {
    ...d,
    player_a: closed ? d.player_a : null,
    player_b: closed ? d.player_b : null,
    winner: closed ? d.winner : null,
    votes_a: closed ? d.votes_a : null,
    votes_b: closed ? d.votes_b : null,
  };
}

export function createDemoApi() {
  return {
    mode: 'demo',

    async listTournaments() {
      return [...load().tournaments].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    async getPublicState(tid) {
      const s = fullState(load(), tid);
      if (!s) return null;
      return {
        ...s,
        players: s.players.map(({ code, ...p }) => p),
        duels: s.duels.map(maskDuel),
      };
    },

    async voterLogin(code) {
      const p = load().players.find((x) => x.code === norm(code));
      return p ? { id: p.id, name: p.name, tournament_id: p.tournament_id, is_competitor: p.is_competitor } : null;
    },

    async voterBallot(code) {
      const db = load();
      const p = db.players.find((x) => x.code === norm(code));
      if (!p) return [];
      return db.duels
        .filter((d) => d.tournament_id === p.tournament_id && d.status === 'open')
        .map((d) => {
          const r = db.rounds.find((x) => x.id === d.round_id);
          const v = db.votes.find((x) => x.duel_id === d.id && x.voter_id === p.id);
          return {
            duel_id: d.id, round_number: r.number, phase: r.phase, letter: r.letter, theme: r.theme, slot: d.slot,
            photo_a: d.photo_a, photo_b: d.photo_b,
            is_mine: p.id === d.player_a || p.id === d.player_b,
            my_choice: v ? v.choice : null,
          };
        })
        .sort((a, b) => a.round_number - b.round_number || a.slot - b.slot);
    },

    async castVote(code, duelId, choice) {
      const db = load();
      const p = db.players.find((x) => x.code === norm(code));
      if (!p) return 'codigo_invalido';
      const d = db.duels.find((x) => x.id === duelId);
      if (!d || d.tournament_id !== p.tournament_id) return 'duelo_invalido';
      if (d.status !== 'open') return 'votacao_fechada';
      if (p.id === d.player_a || p.id === d.player_b) return 'proprio_duelo';
      if (!['A', 'B'].includes(choice)) return 'escolha_invalida';
      db.votes = db.votes.filter((v) => !(v.duel_id === duelId && v.voter_id === p.id));
      db.votes.push({ duel_id: duelId, voter_id: p.id, choice, created_at: now() });
      save(db);
      return 'ok';
    },

    // Professor ----------------------------------------------------------

    async getAdminUser() {
      return sessionStorage.getItem('torneio-demo-admin') ? { email: 'demo' } : null;
    },

    async adminLogin() {
      sessionStorage.setItem('torneio-demo-admin', '1');
    },

    async adminLogout() {
      sessionStorage.removeItem('torneio-demo-admin');
    },

    async getAdminState(tid) {
      return fullState(load(), tid);
    },

    async createTournament({ name, swiss_rounds, cut_size, names }) {
      const db = load();
      const t = { id: uid(), name, status: 'swiss', swiss_rounds, cut_size, created_at: now() };
      db.tournaments.push(t);
      const used = new Set(db.players.map((p) => p.code));
      const code = () => { let c; do c = makeCode(); while (used.has(c)); used.add(c); return c; };
      for (const n of names) db.players.push({ id: uid(), tournament_id: t.id, name: n, code: code(), is_competitor: true, created_at: now() });
      db.players.push({ id: uid(), tournament_id: t.id, name: 'Professor', code: code(), is_competitor: false, created_at: now() });
      save(db);
      return t.id;
    },

    async updateTournament(id, patch) {
      const db = load();
      Object.assign(db.tournaments.find((t) => t.id === id), patch);
      save(db);
    },

    async deleteTournament(id) {
      const db = load();
      const duelIds = new Set(db.duels.filter((d) => d.tournament_id === id).map((d) => d.id));
      db.votes = db.votes.filter((v) => !duelIds.has(v.duel_id));
      db.duels = db.duels.filter((d) => d.tournament_id !== id);
      db.rounds = db.rounds.filter((r) => r.tournament_id !== id);
      db.players = db.players.filter((p) => p.tournament_id !== id);
      db.tournaments = db.tournaments.filter((t) => t.id !== id);
      save(db);
    },

    async addPlayer(tid, name, is_competitor = true) {
      const db = load();
      const used = new Set(db.players.map((p) => p.code));
      let c; do c = makeCode(); while (used.has(c));
      db.players.push({ id: uid(), tournament_id: tid, name, code: c, is_competitor, created_at: now() });
      save(db);
    },

    async updatePlayer(id, patch) {
      const db = load();
      Object.assign(db.players.find((p) => p.id === id), patch);
      save(db);
    },

    async deletePlayer(id) {
      const db = load();
      db.players = db.players.filter((p) => p.id !== id);
      db.votes = db.votes.filter((v) => v.voter_id !== id);
      save(db);
    },

    async createRound(tid, round, pairs) {
      const db = load();
      const r = { id: uid(), tournament_id: tid, status: 'open', timer_started_at: null, created_at: now(), ...round };
      db.rounds.push(r);
      pairs.forEach(([a, b], slot) => {
        db.duels.push({
          id: uid(), tournament_id: tid, round_id: r.id, slot, player_a: a, player_b: b,
          photo_a: null, photo_b: null,
          status: b ? 'pending' : 'closed', winner: b ? null : a, created_at: now(),
        });
      });
      save(db);
      return r.id;
    },

    async updateRound(id, patch) {
      const db = load();
      Object.assign(db.rounds.find((r) => r.id === id), patch);
      save(db);
    },

    async deleteRound(id) {
      const db = load();
      const duelIds = new Set(db.duels.filter((d) => d.round_id === id).map((d) => d.id));
      db.votes = db.votes.filter((v) => !duelIds.has(v.duel_id));
      db.duels = db.duels.filter((d) => d.round_id !== id);
      db.rounds = db.rounds.filter((r) => r.id !== id);
      save(db);
    },

    async updateDuel(id, patch) {
      const db = load();
      Object.assign(db.duels.find((d) => d.id === id), patch);
      save(db);
    },

    async uploadPhoto(tid, duelId, side, file) {
      // Mais pequena que no Supabase, para caber no localStorage.
      const url = await blobToDataURL(await resizeImage(file, 700, 0.75));
      await this.updateDuel(duelId, { [side === 'A' ? 'photo_a' : 'photo_b']: url });
      return url;
    },

    // Só no modo demonstração: todos os votantes em falta votam ao acaso.
    async simulateVotes(tid) {
      const db = load();
      const voters = db.players.filter((p) => p.tournament_id === tid);
      for (const d of db.duels.filter((x) => x.tournament_id === tid && x.status === 'open')) {
        for (const p of voters) {
          if (p.id === d.player_a || p.id === d.player_b) continue;
          if (db.votes.some((v) => v.duel_id === d.id && v.voter_id === p.id)) continue;
          db.votes.push({ duel_id: d.id, voter_id: p.id, choice: Math.random() < 0.5 ? 'A' : 'B', created_at: now() });
        }
      }
      save(db);
    },
  };
}

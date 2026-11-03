// Ligação ao Supabase. As regras de segurança estão em supabase/schema.sql.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { makeCode } from './logic.js';
import { resizeImage } from './ui.js';

const BUCKET = 'desenhos';

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function createSupabaseApi(url, key) {
  const sb = createClient(url, key);

  async function insertPlayers(rows) {
    // Os códigos são únicos; numa colisão (rara) gera novos e tenta outra vez.
    for (let attempt = 0; attempt < 5; attempt++) {
      const withCodes = rows.map((r) => ({ ...r, code: makeCode() }));
      const { error } = await sb.from('players').insert(withCodes);
      if (!error) return;
      if (error.code !== '23505') throw new Error(error.message);
    }
    throw new Error('Não foi possível gerar códigos únicos.');
  }

  return {
    mode: 'supabase',

    async listTournaments() {
      return check(await sb.from('tournaments').select('*').order('created_at', { ascending: false }));
    },

    async getPublicState(tid) {
      const [t, players, rounds, duels] = await Promise.all([
        sb.from('tournaments').select('*').eq('id', tid).maybeSingle(),
        sb.from('v_players').select('*').eq('tournament_id', tid),
        sb.from('rounds').select('*').eq('tournament_id', tid),
        sb.from('v_duels').select('*').eq('tournament_id', tid),
      ]);
      const tournament = check(t);
      if (!tournament) return null;
      return { tournament, players: check(players), rounds: check(rounds), duels: check(duels) };
    },

    async voterLogin(code) {
      const rows = check(await sb.rpc('voter_login', { p_code: code }));
      return rows[0] || null;
    },

    async voterBallot(code) {
      return check(await sb.rpc('voter_ballot', { p_code: code }));
    },

    async castVote(code, duelId, choice) {
      return check(await sb.rpc('cast_vote', { p_code: code, p_duel: duelId, p_choice: choice }));
    },

    // Professor ----------------------------------------------------------

    async getAdminUser() {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email } : null;
    },

    async adminLogin(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error('Email ou palavra-passe errados.');
    },

    async adminLogout() {
      await sb.auth.signOut();
    },

    async getAdminState(tid) {
      const [t, players, rounds, duels, counts] = await Promise.all([
        sb.from('tournaments').select('*').eq('id', tid).maybeSingle(),
        sb.from('players').select('*').eq('tournament_id', tid),
        sb.from('rounds').select('*').eq('tournament_id', tid),
        sb.from('duels').select('*').eq('tournament_id', tid),
        sb.from('v_admin_duel_votes').select('*').eq('tournament_id', tid),
      ]);
      const tournament = check(t);
      if (!tournament) return null;
      const byDuel = new Map(check(counts).map((c) => [c.duel_id, c]));
      return {
        tournament,
        players: check(players),
        rounds: check(rounds),
        duels: check(duels).map((d) => {
          const c = byDuel.get(d.id) || {};
          return { ...d, votes_a: c.votes_a || 0, votes_b: c.votes_b || 0, votes_total: c.votes_total || 0 };
        }),
      };
    },

    async createTournament({ name, swiss_rounds, cut_size, names }) {
      const t = check(await sb.from('tournaments').insert({ name, swiss_rounds, cut_size }).select().single());
      await insertPlayers([
        ...names.map((n) => ({ tournament_id: t.id, name: n, is_competitor: true })),
        { tournament_id: t.id, name: 'Professor', is_competitor: false },
      ]);
      return t.id;
    },

    async updateTournament(id, patch) {
      check(await sb.from('tournaments').update(patch).eq('id', id));
    },

    async deleteTournament(id) {
      const { data: files } = await sb.storage.from(BUCKET).list(id, { limit: 1000 });
      if (files?.length) await sb.storage.from(BUCKET).remove(files.map((f) => `${id}/${f.name}`));
      check(await sb.from('tournaments').delete().eq('id', id));
    },

    async addPlayer(tid, name, is_competitor = true) {
      await insertPlayers([{ tournament_id: tid, name, is_competitor }]);
    },

    async updatePlayer(id, patch) {
      check(await sb.from('players').update(patch).eq('id', id));
    },

    async deletePlayer(id) {
      check(await sb.from('players').delete().eq('id', id));
    },

    async createRound(tid, round, pairs) {
      const r = check(await sb.from('rounds').insert({ tournament_id: tid, ...round }).select().single());
      const duels = pairs.map(([a, b], slot) => ({
        tournament_id: tid, round_id: r.id, slot, player_a: a, player_b: b,
        status: b ? 'pending' : 'closed', winner: b ? null : a,
      }));
      check(await sb.from('duels').insert(duels));
      return r.id;
    },

    async updateRound(id, patch) {
      check(await sb.from('rounds').update(patch).eq('id', id));
    },

    async deleteRound(id) {
      check(await sb.from('rounds').delete().eq('id', id));
    },

    async updateDuel(id, patch) {
      check(await sb.from('duels').update(patch).eq('id', id));
    },

    async uploadPhoto(tid, duelId, side, file) {
      const blob = await resizeImage(file, 1600, 0.85);
      const path = `${tid}/${duelId}-${side}-${Date.now()}.jpg`;
      check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      await this.updateDuel(duelId, { [side === 'A' ? 'photo_a' : 'photo_b']: data.publicUrl });
      return data.publicUrl;
    },
  };
}

-- Torneio de Tipografia — esquema da base de dados (Supabase)
-- Correr uma vez no SQL Editor do projeto Supabase.
-- ANTES de correr: substituir o email na secção "1. Professor" pelo email
-- da conta de professor criada em Authentication → Users.

-- 1. Professor ---------------------------------------------------------------

create table if not exists public.admins (
  email text primary key
);

insert into public.admins (email) values ('EMAIL-DO-PROFESSOR@exemplo.com')
on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where email = (auth.jwt() ->> 'email'));
$$;

-- 2. Tabelas -----------------------------------------------------------------

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'swiss' check (status in ('swiss', 'ko', 'finished')),
  swiss_rounds int not null default 3,
  cut_size int not null default 8,
  created_at timestamptz not null default now()
);

-- Alunos e votantes. is_competitor = false para o professor (só vota).
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  name text not null,
  code text not null unique,
  is_competitor boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  number int not null,
  phase text not null check (phase in ('swiss', 'ko')),
  letter text not null,
  theme text,
  draw_minutes int not null default 5,
  status text not null default 'open' check (status in ('open', 'closed')),
  timer_started_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, number)
);

-- Cada duelo: o lado A/B é sorteado para a votação ser anónima.
create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  round_id uuid not null references public.rounds on delete cascade,
  slot int not null,
  player_a uuid references public.players on delete set null,
  player_b uuid references public.players on delete set null,
  photo_a text,
  photo_b text,
  status text not null default 'pending' check (status in ('pending', 'open', 'closed')),
  winner uuid references public.players on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  duel_id uuid not null references public.duels on delete cascade,
  voter_id uuid not null references public.players on delete cascade,
  choice text not null check (choice in ('A', 'B')),
  created_at timestamptz not null default now(),
  primary key (duel_id, voter_id)
);

create index if not exists duels_tournament_idx on public.duels (tournament_id);
create index if not exists rounds_tournament_idx on public.rounds (tournament_id);
create index if not exists players_tournament_idx on public.players (tournament_id);

-- 3. Segurança (RLS) ---------------------------------------------------------
-- O professor pode tudo. O público só lê torneios, rondas e as vistas abaixo;
-- os alunos votam apenas através das funções cast_vote / voter_*.

alter table public.admins enable row level security;
alter table public.tournaments enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.duels enable row level security;
alter table public.votes enable row level security;

drop policy if exists "admin all" on public.tournaments;
drop policy if exists "admin all" on public.players;
drop policy if exists "admin all" on public.rounds;
drop policy if exists "admin all" on public.duels;
drop policy if exists "admin all" on public.votes;
drop policy if exists "public read" on public.tournaments;
drop policy if exists "public read" on public.rounds;

create policy "admin all" on public.tournaments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.players for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.rounds for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.duels for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.votes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "public read" on public.tournaments for select to anon, authenticated using (true);
create policy "public read" on public.rounds for select to anon, authenticated using (true);

-- 4. Vistas públicas ---------------------------------------------------------
-- Os nomes, o vencedor e a contagem de votos só aparecem depois de o duelo fechar.

create or replace view public.v_players as
  select id, tournament_id, name, is_competitor from public.players;

create or replace view public.v_duels as
  select
    d.id, d.tournament_id, d.round_id, d.slot, d.status, d.photo_a, d.photo_b,
    case when d.status = 'closed' then d.player_a end as player_a,
    case when d.status = 'closed' then d.player_b end as player_b,
    case when d.status = 'closed' then d.winner end as winner,
    case when d.status = 'closed' then (select count(*) from public.votes v where v.duel_id = d.id and v.choice = 'A') end::int as votes_a,
    case when d.status = 'closed' then (select count(*) from public.votes v where v.duel_id = d.id and v.choice = 'B') end::int as votes_b,
    (select count(*) from public.votes v where v.duel_id = d.id)::int as votes_total
  from public.duels d;

-- Contagem em direto, só para o professor.
create or replace view public.v_admin_duel_votes as
  select d.id as duel_id, d.tournament_id,
         (count(v.choice) filter (where v.choice = 'A'))::int as votes_a,
         (count(v.choice) filter (where v.choice = 'B'))::int as votes_b,
         count(v.choice)::int as votes_total
  from public.duels d
  left join public.votes v on v.duel_id = d.id
  where public.is_admin()
  group by d.id;

-- 5. Funções para os alunos --------------------------------------------------

create or replace function public.voter_login(p_code text)
returns table (id uuid, name text, tournament_id uuid, is_competitor boolean)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.tournament_id, p.is_competitor
  from public.players p
  where p.code = upper(trim(p_code));
$$;

create or replace function public.voter_ballot(p_code text)
returns table (
  duel_id uuid, round_number int, phase text, letter text, theme text, slot int,
  photo_a text, photo_b text, is_mine boolean, my_choice text
)
language sql stable security definer set search_path = public
as $$
  select d.id, r.number, r.phase, r.letter, r.theme, d.slot, d.photo_a, d.photo_b,
         coalesce(p.id = d.player_a or p.id = d.player_b, false), v.choice
  from public.players p
  join public.duels d on d.tournament_id = p.tournament_id and d.status = 'open'
  join public.rounds r on r.id = d.round_id
  left join public.votes v on v.duel_id = d.id and v.voter_id = p.id
  where p.code = upper(trim(p_code))
  order by r.number, d.slot;
$$;

create or replace function public.cast_vote(p_code text, p_duel uuid, p_choice text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_player public.players;
  v_duel public.duels;
begin
  select * into v_player from public.players where code = upper(trim(p_code));
  if not found then return 'codigo_invalido'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found or v_duel.tournament_id <> v_player.tournament_id then return 'duelo_invalido'; end if;
  if v_duel.status <> 'open' then return 'votacao_fechada'; end if;
  if v_player.id = v_duel.player_a or v_player.id = v_duel.player_b then return 'proprio_duelo'; end if;
  if p_choice not in ('A', 'B') then return 'escolha_invalida'; end if;

  insert into public.votes (duel_id, voter_id, choice)
  values (p_duel, v_player.id, p_choice)
  on conflict (duel_id, voter_id) do update set choice = excluded.choice, created_at = now();
  return 'ok';
end;
$$;

-- 6. Permissões --------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select on public.tournaments, public.rounds, public.v_players, public.v_duels to anon, authenticated;
grant all on public.tournaments, public.players, public.rounds, public.duels, public.votes to authenticated;
grant select on public.v_admin_duel_votes to authenticated;
grant execute on function public.voter_login(text), public.voter_ballot(text), public.cast_vote(text, uuid, text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- 7. Fotografias -------------------------------------------------------------
-- Pasta pública "desenhos": todos veem, só o professor carrega ou apaga.

insert into storage.buckets (id, name, public)
values ('desenhos', 'desenhos', true)
on conflict (id) do nothing;

drop policy if exists "desenhos admin insert" on storage.objects;
drop policy if exists "desenhos admin update" on storage.objects;
drop policy if exists "desenhos admin delete" on storage.objects;

create policy "desenhos admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'desenhos' and public.is_admin());
create policy "desenhos admin update" on storage.objects for update to authenticated
  using (bucket_id = 'desenhos' and public.is_admin());
create policy "desenhos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'desenhos' and public.is_admin());

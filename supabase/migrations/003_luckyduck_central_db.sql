-- Rock The Draw v4 — PANGKALAN DATA PUSAT (ternormal) + Supabase Auth + peranan.
--
-- Prinsip:
--  * Jadual dalam skema `luckyduck` (tidak didedahkan melalui API REST). RLS DIHIDUPKAN pada semua jadual
--    tanpa sebarang polisi → akses terus ditolak. Semua akses melalui fungsi RPC `public.ldr_*`
--    (SECURITY DEFINER) yang menyemak auth.uid() + peranan (admin / registrar / operator).
--  * Setiap jadual entiti menyimpan lajur bertaip (untuk kekangan & laporan) + `doc` (rekod penuh seperti
--    yang digunakan oleh aplikasi). Lajur bertaip diisi oleh pencetus daripada `doc`.
--  * Setiap perubahan mendapat `rev` (jujukan global) → pelayar menarik perubahan sejak rev terakhir.
--    Padam → `tombstones`. `public.ldr_pulse` dikemas kini selepas setiap RPC yang mengubah data →
--    Supabase Realtime memberitahu semua pelayar untuk menarik data serta-merta.
--  * Kehadiran (QR / kaunter / luar talian) → peserta cabutan dicipta DI PELAYAN secara atomik.
--  * Cabutan dalam talian dibuat DI PELAYAN (ldr_draw) dengan kunci baris majlis + rawak kriptografi.

-- ============================================================================ peranan & pengguna
create table if not exists luckyduck.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  name text not null default '' check (char_length(name) <= 120),
  role text check (role in ('admin', 'registrar', 'operator')),   -- null = menunggu kelulusan
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists luckyduck.bootstrap (
  id int primary key default 1 check (id = 1),
  code_hash text not null,
  used_at timestamptz,
  used_by uuid
);

-- ============================================================================ majlis
alter table luckyduck.events alter column admin_hash drop not null;
alter table luckyduck.events add column if not exists is_active boolean not null default false;
alter table luckyduck.events add column if not exists duck_seq int not null default 1;
alter table luckyduck.events add column if not exists winner_seq int not null default 1;
alter table luckyduck.events add column if not exists created_by uuid;
alter table luckyduck.events add column if not exists qr_token text;
alter table luckyduck.events add column if not exists control_device text;
alter table luckyduck.events add column if not exists control_name text;
alter table luckyduck.events add column if not exists control_at timestamptz;

-- ============================================================================ jadual entiti
create sequence if not exists luckyduck.doc_rev;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'luckyduck' and table_name = 'staff' and column_name = 'checked_in_at') then
    alter table luckyduck.staff rename to staff_legacy;
  end if;
end $$;

create table if not exists luckyduck.staff (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 40),     -- No. Pekerja (unik setiap majlis)
  staff_id text not null,
  name text not null check (char_length(name) between 1 and 120),
  department text not null default '',
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create table if not exists luckyduck.attendance (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null,                                                -- No. Pekerja → SATU kehadiran setiap staf
  staff_id text not null,
  checked_in_at timestamptz not null,
  via text not null default 'qr' check (via in ('qr', 'manual', 'offline')),
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create table if not exists luckyduck.participants (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null,
  staff_id text not null,
  name text not null default '',
  department text not null default '',
  duck_no int not null,
  status text not null check (status in ('ELIGIBLE', 'WINNER')),
  win_count int not null default 0,
  source text not null default 'import',
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create unique index if not exists participants_duck_uidx on luckyduck.participants (event_id, duck_no);
create index if not exists participants_status_idx on luckyduck.participants (event_id, status);

create table if not exists luckyduck.prize_categories (
  code text primary key, name text not null, sort int not null
);
insert into luckyduck.prize_categories (code, name, sort) values
  ('UTAMA', 'Hadiah Utama', 1), ('PERTAMA', 'Hadiah Pertama', 2), ('KEDUA', 'Hadiah Kedua', 3),
  ('KETIGA', 'Hadiah Ketiga', 4), ('SAGU_HATI', 'Hadiah Sagu Hati', 5), ('ISTIMEWA', 'Hadiah Istimewa', 6)
on conflict (code) do nothing;

create table if not exists luckyduck.prizes (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null,
  category text not null default '', name text not null default '',
  quantity int not null default 1 check (quantity between 1 and 10000), sequence int not null default 1,
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create table if not exists luckyduck.draw_sessions (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null,
  prize_id text not null default '', winners int not null default 0, pool_size int not null default 0,
  integrity text not null default '', mode text not null default 'offline',
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create table if not exists luckyduck.winners (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null,
  draw_id text not null default '', staff_id text not null, prize_id text not null default '',
  winner_no int, revoked boolean not null default false,
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create index if not exists winners_prize_idx on luckyduck.winners (event_id, prize_id) where not revoked;
create unique index if not exists winners_draw_staff_uidx on luckyduck.winners (event_id, draw_id, staff_id);

create table if not exists luckyduck.audit_logs (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null,
  at timestamptz not null default now(), action text not null default '',
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create table if not exists luckyduck.settings (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  key text not null check (key in ('app', 'duckSeq', 'winnerSeq')),
  doc jsonb not null,
  rev bigint not null, updated_at timestamptz not null default now(), updated_by uuid, device text,
  primary key (event_id, key)
);
create table if not exists luckyduck.tombstones (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  store text not null, key text not null, rev bigint not null, deleted_at timestamptz not null default now(),
  primary key (event_id, store, key)
);
-- Log penyegerakan: operasi yang ditolak / gagal (untuk audit & cuba semula)
create table if not exists luckyduck.sync_queue (
  id bigint generated always as identity primary key,
  event_id uuid references luckyduck.events(id) on delete cascade,
  user_id uuid, device text, store text, key text, op text, status text not null, error text,
  received_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['staff', 'attendance', 'participants', 'prizes', 'draw_sessions', 'winners', 'audit_logs', 'settings', 'tombstones'] loop
    execute format('create index if not exists %I on luckyduck.%I (event_id, rev)', t || '_rev_idx', t);
  end loop;
  foreach t in array array['app_users', 'bootstrap', 'staff', 'attendance', 'participants', 'prize_categories', 'prizes', 'draw_sessions', 'winners', 'audit_logs', 'settings', 'tombstones', 'sync_queue'] loop
    execute format('alter table luckyduck.%I enable row level security', t);
  end loop;
end $$;
revoke all on all tables in schema luckyduck from public, anon, authenticated;
revoke all on all sequences in schema luckyduck from public, anon, authenticated;

-- ============================================================================ pencetus
-- Nama stor aplikasi ↔ jadual
create or replace function luckyduck.tbl(p_store text) returns text
language sql immutable set search_path = '' as $$
  select case p_store when 'staff' then 'staff' when 'attendance' then 'attendance' when 'participants' then 'participants'
    when 'prizes' then 'prizes' when 'draws' then 'draw_sessions' when 'winners' then 'winners' when 'audit' then 'audit_logs'
    when 'settings' then 'settings' end
$$;
create or replace function luckyduck.store_of(p_table text) returns text
language sql immutable set search_path = '' as $$
  select case p_table when 'draw_sessions' then 'draws' when 'audit_logs' then 'audit' else p_table end
$$;

-- Sebelum tulis: rev baharu + lajur bertaip daripada doc (+ nombor itik unik bagi peserta)
create or replace function luckyduck.tg_doc() returns trigger
language plpgsql set search_path = '' as $$
declare d jsonb := new.doc; n int; seq int; p jsonb;
begin
  if jsonb_typeof(d) <> 'object' then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  case tg_table_name
    when 'staff' then
      d := d || jsonb_build_object('staffId', new.key);
      if coalesce(btrim(d ->> 'name'), '') = '' then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
      p := jsonb_build_object('staff_id', new.key, 'name', left(btrim(d ->> 'name'), 120), 'department', left(coalesce(d ->> 'department', ''), 120));
    when 'attendance' then
      d := d || jsonb_build_object('staffId', new.key, 'checkedInAt', coalesce(d ->> 'checkedInAt', now()::text));
      p := jsonb_build_object('staff_id', new.key, 'checked_in_at', d ->> 'checkedInAt',
             'via', case when d ->> 'via' in ('qr', 'manual', 'offline') then d ->> 'via' else 'manual' end);
    when 'participants' then
      perform 1 from luckyduck.events e where e.id = new.event_id for update;   -- serialkan penomboran itik
      d := d || jsonb_build_object('staffId', new.key);
      n := nullif(d ->> 'duckNo', '')::int;
      if n is null or n < 1 or exists (select 1 from luckyduck.participants x where x.event_id = new.event_id and x.duck_no = n and x.key <> new.key) then
        select greatest(e.duck_seq, coalesce((select max(x.duck_no) from luckyduck.participants x where x.event_id = new.event_id), 0) + 1)
          into n from luckyduck.events e where e.id = new.event_id;
        d := d || jsonb_build_object('duckNo', n);
      end if;
      update luckyduck.events e set duck_seq = greatest(e.duck_seq, n + 1) where e.id = new.event_id;
      p := jsonb_build_object('staff_id', new.key, 'name', coalesce(d ->> 'name', ''), 'department', coalesce(d ->> 'department', ''),
             'duck_no', n, 'status', case when d ->> 'status' = 'WINNER' then 'WINNER' else 'ELIGIBLE' end,
             'win_count', coalesce(nullif(d ->> 'winCount', '')::int, 0), 'source', coalesce(d ->> 'source', 'import'));
    when 'prizes' then
      p := jsonb_build_object('category', coalesce(d ->> 'category', ''), 'name', coalesce(d ->> 'name', ''),
             'quantity', least(10000, greatest(1, coalesce(nullif(d ->> 'quantity', '')::int, 1))), 'sequence', coalesce(nullif(d ->> 'sequence', '')::int, 1));
    when 'draw_sessions' then
      p := jsonb_build_object('prize_id', coalesce(d ->> 'prizeId', ''), 'winners', coalesce(nullif(d ->> 'count', '')::int, 0),
             'pool_size', coalesce(nullif(d ->> 'poolSize', '')::int, 0), 'integrity', coalesce(d ->> 'integrity', ''), 'mode', coalesce(d ->> 'mode', 'offline'));
    when 'winners' then
      p := jsonb_build_object('draw_id', coalesce(d ->> 'drawId', ''), 'staff_id', coalesce(d ->> 'staffId', ''), 'prize_id', coalesce(d ->> 'prizeId', ''),
             'winner_no', nullif(d ->> 'winnerNo', '')::int, 'revoked', coalesce((d ->> 'revoked')::boolean, false));
    when 'audit_logs' then
      p := jsonb_build_object('at', coalesce(d ->> 'at', now()::text), 'action', left(coalesce(d ->> 'action', ''), 60));
    else p := '{}'::jsonb;
  end case;
  new := jsonb_populate_record(new, p || jsonb_build_object('doc', d, 'rev', nextval('luckyduck.doc_rev'), 'updated_at', now()));
  if tg_op = 'INSERT' then
    delete from luckyduck.tombstones t where t.event_id = new.event_id and t.store = luckyduck.store_of(tg_table_name) and t.key = new.key;
  end if;
  return new;
end $$;

create or replace function luckyduck.tg_tombstone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from luckyduck.events e where e.id = old.event_id) then return old; end if;   -- majlis sedang dipadam
  insert into luckyduck.tombstones (event_id, store, key, rev) values (old.event_id, luckyduck.store_of(tg_table_name), old.key, nextval('luckyduck.doc_rev'))
  on conflict (event_id, store, key) do update set rev = excluded.rev, deleted_at = now();
  return old;
end $$;

-- Kehadiran → peserta cabutan (atomik, sekali sahaja)
create or replace function luckyduck.tg_attendance_in() returns trigger
language plpgsql set search_path = '' as $$
declare s luckyduck.staff; p luckyduck.participants;
begin
  select * into s from luckyduck.staff x where x.event_id = new.event_id and x.key = new.key;
  select * into p from luckyduck.participants x where x.event_id = new.event_id and x.key = new.key;
  if p.key is null then
    insert into luckyduck.participants (event_id, key, staff_id, name, department, duck_no, status, doc, rev, updated_by, device)
    values (new.event_id, new.key, new.key, '', '', 0, 'ELIGIBLE', jsonb_build_object(
      'staffId', new.key, 'name', coalesce(s.name, new.doc ->> 'name', new.key), 'department', coalesce(s.department, new.doc ->> 'department', ''),
      'status', 'ELIGIBLE', 'winCount', 0, 'source', 'attendance', 'checkedInAt', new.checked_in_at,
      'createdAt', now(), 'updatedAt', now()), 0, new.updated_by, new.device);
  elsif p.doc ->> 'checkedInAt' is null then
    update luckyduck.participants x set doc = x.doc || jsonb_build_object('checkedInAt', new.checked_in_at, 'updatedAt', now())
    where x.event_id = new.event_id and x.key = new.key;
  end if;
  return null;
end $$;

create or replace function luckyduck.tg_attendance_out() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from luckyduck.participants x where x.event_id = old.event_id and x.key = old.key
    and x.source = 'attendance' and x.status = 'ELIGIBLE' and x.win_count = 0;
  update luckyduck.participants x set doc = x.doc || jsonb_build_object('checkedInAt', null, 'updatedAt', now())
    where x.event_id = old.event_id and x.key = old.key;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['staff', 'attendance', 'participants', 'prizes', 'draw_sessions', 'winners', 'audit_logs', 'settings'] loop
    execute format('drop trigger if exists tg_doc on luckyduck.%I', t);
    execute format('create trigger tg_doc before insert or update on luckyduck.%I for each row execute function luckyduck.tg_doc()', t);
    execute format('drop trigger if exists tg_tomb on luckyduck.%I', t);
    execute format('create trigger tg_tomb after delete on luckyduck.%I for each row execute function luckyduck.tg_tombstone()', t);
  end loop;
end $$;
drop trigger if exists tg_att_in on luckyduck.attendance;
create trigger tg_att_in after insert on luckyduck.attendance for each row execute function luckyduck.tg_attendance_in();
drop trigger if exists tg_att_out on luckyduck.attendance;
create trigger tg_att_out after delete on luckyduck.attendance for each row execute function luckyduck.tg_attendance_out();

-- ============================================================================ Realtime: denyut perubahan
create table if not exists public.ldr_pulse (
  event_id uuid primary key,
  rev bigint not null default 0,
  at timestamptz not null default now()
);
alter table public.ldr_pulse enable row level security;
revoke all on public.ldr_pulse from public, anon, authenticated;
grant select on public.ldr_pulse to authenticated;

create or replace function luckyduck.pulse(p_event uuid) returns void
language sql set search_path = '' as $$
  insert into public.ldr_pulse (event_id, rev, at) values (p_event, currval('luckyduck.doc_rev'), now())
  on conflict (event_id) do update set rev = excluded.rev, at = now()
$$;

-- ============================================================================ pembantu peranan
create or replace function luckyduck.my_role() returns text
language sql stable set search_path = '' as $$
  select u.role from luckyduck.app_users u where u.user_id = auth.uid() and u.active
$$;
create or replace function luckyduck.need(variadic p_roles text[]) returns text
language plpgsql stable set search_path = '' as $$
declare r text := luckyduck.my_role();
begin
  if auth.uid() is null then raise exception 'AUTH' using errcode = 'P0001'; end if;
  if r is null or not (r = any (p_roles)) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return r;
end $$;

create or replace function public.ldr_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select luckyduck.my_role() is not null
$$;
drop policy if exists pulse_members on public.ldr_pulse;
create policy pulse_members on public.ldr_pulse for select to authenticated using ((select public.ldr_is_member()));

create or replace function luckyduck.meta(p_event uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('event_id', e.id, 'name', e.name, 'is_open', e.is_open, 'is_active', e.is_active, 'qr_token', e.qr_token,
    'control_device', e.control_device, 'control_name', e.control_name, 'created_at', e.created_at,
    'legacy', e.admin_hash is not null and e.qr_token is null)
  from luckyduck.events e where e.id = p_event
$$;

-- ============================================================================ RPC: akaun
create or replace function public.ldr_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u luckyduck.app_users; ev uuid;
begin
  if auth.uid() is null then raise exception 'AUTH' using errcode = 'P0001'; end if;
  insert into luckyduck.app_users (user_id, email, name)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), left(coalesce(auth.jwt() -> 'user_metadata' ->> 'name', ''), 120))
  on conflict (user_id) do update set email = excluded.email;
  select * into u from luckyduck.app_users where user_id = auth.uid();
  select id into ev from luckyduck.events where is_active order by created_at desc limit 1;
  return jsonb_build_object('user_id', u.user_id, 'email', u.email, 'name', u.name, 'role', case when u.active then u.role end, 'active', u.active,
    'admins', (select count(*) from luckyduck.app_users a where a.role = 'admin' and a.active),
    'event', case when u.active and u.role is not null and ev is not null then luckyduck.meta(ev) end);
end $$;

create or replace function public.ldr_bootstrap_admin(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b luckyduck.bootstrap;
begin
  if auth.uid() is null then raise exception 'AUTH' using errcode = 'P0001'; end if;
  perform luckyduck.throttle('boot:' || luckyduck.client_ip(), 5, 600);
  perform public.ldr_me();
  select * into b from luckyduck.bootstrap where id = 1 for update;
  if b.code_hash is null or b.used_at is not null or b.code_hash <> luckyduck.h(btrim(coalesce(p_code, '')))
     or exists (select 1 from luckyduck.app_users where role = 'admin' and active) then
    raise exception 'BAD_CODE' using errcode = 'P0001';
  end if;
  update luckyduck.app_users set role = 'admin', active = true, name = coalesce(nullif(left(btrim(p_name), 120), ''), name), updated_at = now() where user_id = auth.uid();
  update luckyduck.bootstrap set used_at = now(), used_by = auth.uid() where id = 1;
  return public.ldr_me();
end $$;

create or replace function public.ldr_set_my_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH' using errcode = 'P0001'; end if;
  update luckyduck.app_users set name = left(btrim(coalesce(p_name, '')), 120), updated_at = now() where user_id = auth.uid();
end $$;

create or replace function public.ldr_users_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin');
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'email', u.email, 'name', u.name, 'role', u.role, 'active', u.active,
    'created_at', u.created_at, 'last_sign_in_at', a.last_sign_in_at) order by u.role nulls first, u.email)
    from luckyduck.app_users u left join auth.users a on a.id = u.user_id), '[]'::jsonb);
end $$;

create or replace function public.ldr_user_set(p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin');
  if p_role is not null and p_role not in ('admin', 'registrar', 'operator') then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  update luckyduck.app_users set role = p_role, active = coalesce(p_active, active), updated_at = now() where user_id = p_user;
  if not exists (select 1 from luckyduck.app_users where role = 'admin' and active) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;
end $$;

-- ============================================================================ RPC: majlis
create or replace function public.ldr_events_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin');
  return coalesce((select jsonb_agg(luckyduck.meta(e.id) || jsonb_build_object(
    'participants', (select count(*) from luckyduck.participants p where p.event_id = e.id),
    'staff', (select count(*) from luckyduck.staff s where s.event_id = e.id)) order by e.created_at desc) from luckyduck.events e), '[]'::jsonb);
end $$;

create or replace function public.ldr_event_create(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform luckyduck.need('admin');
  if char_length(coalesce(p_token, '')) < 24 then raise exception 'WEAK_SECRET' using errcode = 'P0001'; end if;
  update luckyduck.events set is_active = false where is_active;
  insert into luckyduck.events (name, token_hash, qr_token, is_active, created_by)
  values (left(coalesce(nullif(btrim(p_name), ''), 'Majlis'), 160), luckyduck.h(p_token), p_token, true, auth.uid()) returning id into v;
  return luckyduck.meta(v);
end $$;

create or replace function public.ldr_event_activate(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin');
  if not exists (select 1 from luckyduck.events where id = p_event) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update luckyduck.events set is_active = (id = p_event);
  return luckyduck.meta(p_event);
end $$;

create or replace function public.ldr_event_update(p_event uuid, p_name text default null, p_is_open boolean default null, p_new_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin');
  if p_new_token is not null and char_length(p_new_token) < 24 then raise exception 'WEAK_SECRET' using errcode = 'P0001'; end if;
  update luckyduck.events set
    name = coalesce(left(nullif(btrim(p_name), ''), 160), name),
    is_open = coalesce(p_is_open, is_open),
    token_hash = case when p_new_token is null then token_hash else luckyduck.h(p_new_token) end,
    qr_token = coalesce(p_new_token, qr_token)
  where id = p_event;
  perform nextval('luckyduck.doc_rev'); perform luckyduck.pulse(p_event);
  return luckyduck.meta(p_event);
end $$;

-- Sambung majlis versi lama (kunci admin laptop) supaya kod QR yang sudah dicetak kekal sah
create or replace function public.ldr_event_link_legacy(p_event uuid, p_admin_key text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin');
  if not exists (select 1 from luckyduck.events where id = p_event and admin_hash = luckyduck.h(p_admin_key) and token_hash = luckyduck.h(p_token)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update luckyduck.events set qr_token = p_token, admin_hash = null, is_active = (id = p_event) where id = p_event or is_active;
  return luckyduck.meta(p_event);
end $$;

create or replace function public.ldr_claim_control(p_event uuid, p_device text, p_device_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.need('admin', 'operator');
  if char_length(coalesce(p_device, '')) not between 8 and 64 then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  update luckyduck.events set control_device = p_device, control_name = left(coalesce(p_device_name, ''), 80), control_at = now() where id = p_event;
  perform nextval('luckyduck.doc_rev'); perform luckyduck.pulse(p_event);
  return luckyduck.meta(p_event);
end $$;

-- ============================================================================ RPC: penyegerakan
create or replace function public.ldr_sync_pull(p_event uuid, p_since bigint, p_limit int default 1000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lim int := least(greatest(coalesce(p_limit, 1000), 1), 2000); rows jsonb; n int;
begin
  perform luckyduck.need('admin', 'operator', 'registrar');
  with u as (
    select 'staff' s, key k, rev r, doc d, false x from luckyduck.staff where event_id = p_event and rev > p_since
    union all select 'attendance', key, rev, doc, false from luckyduck.attendance where event_id = p_event and rev > p_since
    union all select 'participants', key, rev, doc, false from luckyduck.participants where event_id = p_event and rev > p_since
    union all select 'prizes', key, rev, doc, false from luckyduck.prizes where event_id = p_event and rev > p_since
    union all select 'draws', key, rev, doc, false from luckyduck.draw_sessions where event_id = p_event and rev > p_since
    union all select 'winners', key, rev, doc, false from luckyduck.winners where event_id = p_event and rev > p_since
    union all select 'audit', key, rev, doc, false from luckyduck.audit_logs where event_id = p_event and rev > p_since
    union all select 'settings', key, rev, doc, false from luckyduck.settings where event_id = p_event and rev > p_since
    union all select store, key, rev, null, true from luckyduck.tombstones where event_id = p_event and rev > p_since
  ), t as (select * from u order by r limit lim)
  select coalesce(jsonb_agg(jsonb_build_object('s', s, 'k', k, 'r', r, 'd', d, 'x', x) order by r), '[]'::jsonb), count(*) into rows, n from t;
  return jsonb_build_object('rows', rows, 'more', n >= lim, 'meta', luckyduck.meta(p_event));
end $$;

-- p_rows: [{s, k, d (rekod penuh | null), x (padam), b (rev asas)}]
create or replace function public.ldr_sync_push(p_event uuid, p_device text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  role text := luckyduck.need('admin', 'operator', 'registrar');
  ctl boolean; r jsonb; t text; s text; k text; cur_rev bigint; cur_doc jsonb; v_rev bigint; v_doc jsonb; keyf text;
  applied jsonb := '[]'::jsonb; rejected jsonb := '[]'::jsonb; err text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  if not exists (select 1 from luckyduck.events where id = p_event) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select role in ('admin', 'operator') and control_device = p_device into ctl from luckyduck.events where id = p_event;
  for r in select * from jsonb_array_elements(p_rows) loop
    s := r ->> 's'; k := r ->> 'k'; t := luckyduck.tbl(s);
    begin
      if t is null or char_length(coalesce(k, '')) not between 1 and 200 or octet_length(coalesce(r -> 'd', 'null'::jsonb)::text) > 1500000 then
        raise exception 'BAD_INPUT' using errcode = 'P0001';
      end if;
      -- Kebenaran ikut peranan
      if not (role = 'admin'
          or (role = 'operator' and s in ('participants', 'draws', 'winners', 'audit'))
          or (role = 'registrar' and s in ('attendance', 'audit'))) then
        raise exception 'FORBIDDEN' using errcode = 'P0001';
      end if;
      if s = 'settings' and k not in ('app', 'duckSeq', 'winnerSeq') then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
      execute format('select rev, doc from luckyduck.%I where event_id = $1 and key = $2 for update', t) into cur_rev, cur_doc using p_event, k;
      -- Konflik: rekod di pelayan lebih baharu daripada versi yang dilihat peranti ini (kecuali Peranti Kawalan)
      if cur_rev is not null and not coalesce(ctl, false) and s <> 'attendance' and cur_rev > coalesce((r ->> 'b')::bigint, 0) then
        rejected := rejected || jsonb_build_object('s', s, 'k', k, 'r', cur_rev, 'd', cur_doc, 'x', false, 'e', 'CONFLICT');
        insert into luckyduck.sync_queue (event_id, user_id, device, store, key, op, status, error) values (p_event, auth.uid(), p_device, s, k, 'upsert', 'rejected', 'CONFLICT');
        continue;
      end if;
      if coalesce((r ->> 'x')::boolean, false) then
        if role = 'registrar' and s <> 'attendance' then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
        execute format('delete from luckyduck.%I where event_id = $1 and key = $2', t) using p_event, k;
        select rev into v_rev from luckyduck.tombstones where event_id = p_event and store = s and key = k;
        applied := applied || jsonb_build_object('s', s, 'k', k, 'r', coalesce(v_rev, 0), 'x', true);
        continue;
      end if;
      v_doc := r -> 'd';
      keyf := case when s in ('staff', 'attendance', 'participants') then 'staffId' when s = 'settings' then 'key' else 'id' end;
      if jsonb_typeof(v_doc) <> 'object' or coalesce(v_doc ->> keyf, '') <> k then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
      if s = 'attendance' then
        if not exists (select 1 from luckyduck.staff x where x.event_id = p_event and x.key = k) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
        insert into luckyduck.attendance as a (event_id, key, staff_id, checked_in_at, doc, rev, updated_by, device)
        values (p_event, k, k, now(), v_doc, 0, auth.uid(), p_device) on conflict (event_id, key) do nothing;   -- tiada pendua
        select rev, doc into v_rev, v_doc from luckyduck.attendance where event_id = p_event and key = k;
      else
        execute format('insert into luckyduck.%I as t (event_id, key, %s doc, rev, updated_by, device) values ($1, $2, %s $3, 0, $4, $5)
                        on conflict (event_id, key) do update set doc = excluded.doc, updated_by = excluded.updated_by, device = excluded.device
                        returning rev, doc', t,
          case t when 'staff' then 'staff_id, name, ' when 'participants' then 'staff_id, duck_no, status, ' when 'winners' then 'staff_id, ' else '' end,
          case t when 'staff' then '$2, ''-'', ' when 'participants' then '$2, 0, ''ELIGIBLE'', ' when 'winners' then '''-'', ' else '' end)
          into v_rev, v_doc using p_event, k, v_doc, auth.uid(), p_device;
      end if;
      applied := applied || jsonb_build_object('s', s, 'k', k, 'r', v_rev, 'd', v_doc);
    exception when others then
      err := sqlerrm;
      execute format('select rev, doc from luckyduck.%I where event_id = $1 and key = $2', coalesce(t, 'settings')) into cur_rev, cur_doc using p_event, coalesce(k, '');
      rejected := rejected || jsonb_build_object('s', s, 'k', k, 'r', cur_rev, 'd', cur_doc, 'x', cur_doc is null, 'e', err);
      insert into luckyduck.sync_queue (event_id, user_id, device, store, key, op, status, error) values (p_event, auth.uid(), p_device, s, k, 'upsert', 'error', left(err, 300));
    end;
  end loop;
  if jsonb_array_length(applied) > 0 then perform luckyduck.pulse(p_event); end if;
  return jsonb_build_object('applied', applied, 'rejected', rejected, 'control', coalesce(ctl, false), 'role', role);
end $$;

-- ============================================================================ RPC: cabutan di pelayan
create or replace function luckyduck.rand_below(p_n int) returns int
language plpgsql volatile set search_path = '' as $$
declare v bigint; lim bigint;
begin
  if p_n < 1 then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  lim := (4294967296 / p_n) * p_n;          -- penolakan → tiada bias modulo
  loop
    v := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    if v < lim then return (v % p_n)::int; end if;
  end loop;
end $$;

create or replace function public.ldr_draw(p_event uuid, p_draw_id text, p_prize_id text, p_count int, p_reveal text, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e luckyduck.events; st jsonb; multi boolean; prize jsonb; awarded int; prize_no int;
  ids text[]; docs jsonb[]; n int; k int := p_count; i int; j int; tmp text; tmpd jsonb;
  now_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  salt text := encode(extensions.gen_random_bytes(16), 'hex'); wno int; pd jsonb; w jsonb;
  winners jsonb := '[]'::jsonb; winner_ids text[] := '{}'; pool jsonb; draw jsonb; integ text; uname text;
  revs jsonb := '[]'::jsonb; v_rev bigint;
begin
  perform luckyduck.need('admin', 'operator');
  if p_draw_id !~ '^DRW-[0-9]{8}-[0-9A-F]{6}$' then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  select * into e from luckyduck.events where id = p_event for update;          -- satu cabutan pada satu masa
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if exists (select 1 from luckyduck.draw_sessions where event_id = p_event and key = p_draw_id) then raise exception 'DUPLICATE' using errcode = 'P0001'; end if;
  if k is null or k < 1 then raise exception 'BAD_COUNT' using errcode = 'P0001'; end if;
  select doc -> 'value' into st from luckyduck.settings where event_id = p_event and key = 'app';
  multi := coalesce((st ->> 'allowMultipleWins')::boolean, false);
  if coalesce(p_prize_id, '') <> '' then
    select doc into prize from luckyduck.prizes where event_id = p_event and key = p_prize_id;
    if prize is null then raise exception 'PRIZE_NOT_FOUND' using errcode = 'P0001'; end if;
    select count(*) into awarded from luckyduck.winners where event_id = p_event and prize_id = p_prize_id and not revoked;
    if awarded + k > coalesce((prize ->> 'quantity')::int, 1) then raise exception 'PRIZE_EXHAUSTED' using errcode = 'P0001', hint = ((prize ->> 'quantity')::int - awarded)::text; end if;
    prize_no := awarded + 1;
  end if;
  select array_agg(key order by duck_no), array_agg(doc order by duck_no) into ids, docs
    from luckyduck.participants where event_id = p_event and (multi or status = 'ELIGIBLE');
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then raise exception 'NO_ELIGIBLE' using errcode = 'P0001'; end if;
  if k > n then raise exception 'TOO_MANY' using errcode = 'P0001', hint = n::text; end if;
  pool := to_jsonb(docs);
  -- Fisher–Yates separa dengan rawak kriptografi (gen_random_bytes) — sama seperti klien
  for i in 1..k loop
    j := i + luckyduck.rand_below(n - i + 1);
    tmp := ids[i]; ids[i] := ids[j]; ids[j] := tmp;
    tmpd := docs[i]; docs[i] := docs[j]; docs[j] := tmpd;
  end loop;
  select greatest(e.winner_seq, coalesce(max(winner_no), 0) + 1) into wno from luckyduck.winners where event_id = p_event;
  select coalesce(nullif(name, ''), email) into uname from luckyduck.app_users where user_id = auth.uid();
  for i in 1..k loop
    pd := docs[i];
    update luckyduck.participants set doc = doc || jsonb_build_object('status', 'WINNER', 'winCount', coalesce((doc ->> 'winCount')::int, 0) + 1,
      'lastWonAt', now_iso, 'updatedAt', now_iso), updated_by = auth.uid(), device = p_device
    where event_id = p_event and key = ids[i] and (multi or status = 'ELIGIBLE')
    returning rev into v_rev;
    if not found then raise exception 'CONFLICT' using errcode = 'P0001'; end if;
    revs := revs || jsonb_build_object('s', 'participants', 'k', ids[i], 'r', v_rev);
    w := jsonb_build_object('id', 'W-' || p_draw_id || '-' || i, 'drawId', p_draw_id, 'winnerNo', wno, 'rankInDraw', i,
      'prizeId', coalesce(p_prize_id, ''), 'prizeCategory', coalesce(prize ->> 'category', 'Cabutan Khas'), 'prizeName', coalesce(prize ->> 'name', 'Cabutan Khas'),
      'prizeNumber', coalesce(prize_no, 1) + i - 1, 'staffId', ids[i], 'name', pd ->> 'name', 'department', pd ->> 'department',
      'duckNo', (pd ->> 'duckNo')::int, 'drawAt', now_iso, 'revoked', false);
    insert into luckyduck.winners (event_id, key, staff_id, doc, rev, updated_by, device) values (p_event, w ->> 'id', ids[i], w, 0, auth.uid(), p_device)
    returning rev into v_rev;
    revs := revs || jsonb_build_object('s', 'winners', 'k', w ->> 'id', 'r', v_rev);
    winners := winners || w; winner_ids := winner_ids || ids[i]; wno := wno + 1;
  end loop;
  update luckyduck.events set winner_seq = wno where id = p_event;
  integ := encode(sha256(convert_to(p_draw_id || '|' || salt || '|' || array_to_string((select array_agg(x ->> 'staffId') from jsonb_array_elements(pool) x), ',')
            || '|' || array_to_string(winner_ids, ','), 'UTF8')), 'hex');
  draw := jsonb_build_object('id', p_draw_id, 'createdAt', now_iso, 'prizeId', coalesce(p_prize_id, ''), 'prizeCategory', coalesce(prize ->> 'category', 'Cabutan Khas'),
    'prizeName', coalesce(prize ->> 'name', 'Cabutan Khas'), 'count', k, 'poolSize', n,
    'poolIds', (select jsonb_agg(x -> 'staffId') from jsonb_array_elements(pool) x), 'winnerIds', to_jsonb(winner_ids),
    'revealMode', case when p_reveal = 'all' then 'all' else 'one' end, 'status', 'COMMITTED', 'salt', salt, 'allowMultipleWins', multi,
    'integrity', integ, 'mode', 'online', 'by', uname);
  insert into luckyduck.draw_sessions (event_id, key, doc, rev, updated_by, device) values (p_event, p_draw_id, draw, 0, auth.uid(), p_device)
  returning rev into v_rev;
  revs := revs || jsonb_build_object('s', 'draws', 'k', p_draw_id, 'r', v_rev);
  insert into luckyduck.audit_logs (event_id, key, doc, rev, updated_by, device) values (p_event, 'A' || replace(p_draw_id, '-', ''),
    jsonb_build_object('id', 'A' || replace(p_draw_id, '-', ''), 'at', now_iso, 'action', 'CABUTAN', 'user', uname,
      'detail', jsonb_build_object('id', p_draw_id, 'hadiah', draw ->> 'prizeName', 'pemenang', k, 'layak', n, 'staff', to_jsonb(winner_ids), 'pelayan', true)::text), 0, auth.uid(), p_device);
  perform luckyduck.pulse(p_event);
  return jsonb_build_object('draw', draw, 'winners', winners, 'pool', pool, 'prize', prize, 'revs', revs);
end $$;

-- ============================================================================ RPC awam: kehadiran (telefon staf, token QR)
create or replace function public.ldr_event_info(p_event uuid, p_token text)
returns table (name text, is_open boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.throttle('info:' || luckyduck.client_ip(), 60, 60);
  return query select e.name, e.is_open from luckyduck.events e where e.id = p_event and e.token_hash = luckyduck.h(p_token);
  if not found then raise exception 'INVALID_QR' using errcode = 'P0001'; end if;
end $$;

create or replace function public.ldr_lookup(p_event uuid, p_token text, p_staff_id text)
returns table (staff_id text, name text, department text, checked_in_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.throttle('lookup:' || luckyduck.client_ip(), 20, 60);
  perform luckyduck.assert_token(p_event, p_token);
  return query select s.key, s.name, s.department, a.checked_in_at from luckyduck.staff s
    left join luckyduck.attendance a on a.event_id = s.event_id and a.key = s.key
    where s.event_id = p_event and s.key = luckyduck.norm_id(p_staff_id);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
end $$;

create or replace function public.ldr_checkin(p_event uuid, p_token text, p_staff_id text)
returns table (staff_id text, name text, department text, checked_in_at timestamptz, already boolean)
language plpgsql security definer set search_path = '' as $$
declare s luckyduck.staff; a luckyduck.attendance; v_already boolean := true; sid text := luckyduck.norm_id(p_staff_id);
begin
  perform luckyduck.throttle('checkin:' || luckyduck.client_ip(), 20, 60);
  perform luckyduck.assert_token(p_event, p_token);
  select * into s from luckyduck.staff x where x.event_id = p_event and x.key = sid;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  insert into luckyduck.attendance (event_id, key, staff_id, checked_in_at, doc, rev, device)
  values (p_event, sid, sid, now(), jsonb_build_object('staffId', sid, 'checkedInAt', now(), 'via', 'qr'), 0, 'qr')
  on conflict (event_id, key) do nothing
  returning * into a;
  if a.key is not null then v_already := false; perform luckyduck.pulse(p_event);
  else select * into a from luckyduck.attendance x where x.event_id = p_event and x.key = sid; end if;
  return query select s.key, s.name, s.department, a.checked_in_at, v_already;
end $$;

-- ============================================================================ migrasi data sedia ada
insert into luckyduck.staff (event_id, key, staff_id, name, department, doc, rev, updated_at)
select l.event_id, l.staff_id, l.staff_id, l.name, l.department,
       jsonb_build_object('staffId', l.staff_id, 'name', l.name, 'department', l.department, 'updatedAt', l.updated_at), 0, l.updated_at
from luckyduck.staff_legacy l
on conflict (event_id, key) do nothing;
insert into luckyduck.attendance (event_id, key, staff_id, checked_in_at, via, doc, rev)
select l.event_id, l.staff_id, l.staff_id, l.checked_in_at, coalesce(l.checked_in_via, 'qr'),
       jsonb_build_object('staffId', l.staff_id, 'checkedInAt', l.checked_in_at, 'via', coalesce(l.checked_in_via, 'qr')), 0
from luckyduck.staff_legacy l where l.checked_in_at is not null
on conflict (event_id, key) do nothing;
update luckyduck.events set is_active = true where id = (select id from luckyduck.events order by created_at desc limit 1)
  and not exists (select 1 from luckyduck.events where is_active);

-- ============================================================================ buang API lama (v1/v3)
drop function if exists public.ldr_create_event(text, text, text);
drop function if exists public.ldr_admin_update_event(uuid, text, text, boolean, text);
drop function if exists public.ldr_admin_upsert_staff(uuid, text, jsonb);
drop function if exists public.ldr_admin_delete_staff(uuid, text, text[]);
drop function if exists public.ldr_admin_list(uuid, text, timestamptz);
drop function if exists public.ldr_admin_event(uuid, text);
drop function if exists public.ldr_admin_set_checkin(uuid, text, text, boolean);
drop function if exists public.ldr_cloud_enable(uuid, text, text, text, text, text);
drop function if exists public.ldr_cloud_join(text, text, text, text);
drop function if exists public.ldr_cloud_push(uuid, text, jsonb);
drop function if exists public.ldr_cloud_pull(uuid, text, bigint, int);
drop function if exists public.ldr_cloud_claim(uuid, text);
drop function if exists public.ldr_cloud_set_password(uuid, text, text, text);
drop function if exists public.ldr_cloud_leave(uuid, text);
drop function if exists luckyduck.session(uuid, text);
drop function if exists luckyduck.new_session(uuid, text, text);
drop function if exists luckyduck.assert_admin(uuid, text);
drop table if exists luckyduck.docs;
drop table if exists luckyduck.sessions;

-- ============================================================================ kebenaran
revoke execute on all functions in schema luckyduck from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ldr\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('ldr_event_info', 'ldr_lookup', 'ldr_checkin') then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- Realtime
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ldr_pulse') then
    alter publication supabase_realtime add table public.ldr_pulse;
  end if;
end $$;

-- Rock The Draw — penyegerakan awan (dalam talian + luar talian).
-- Setiap majlis (luckyduck.events) boleh diaktifkan sebagai "majlis awan": ada KOD MAJLIS + kata laluan.
-- Pelayar lain menyertai dengan kod + kata laluan → dapat token sesi. Data aplikasi (peserta, hadiah,
-- cabutan, pemenang, audit, tetapan) disimpan sebagai dokumen JSON dengan nombor revisi menaik.
-- Peranti Kawalan (satu per majlis) menang jika konflik; peranti lain guna semakan base_rev.

create table if not exists luckyduck.sessions (
  token_hash text primary key,
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 64),
  device_name text not null default '' check (char_length(device_name) <= 80),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);
create index if not exists sessions_event_idx on luckyduck.sessions (event_id);

alter table luckyduck.events add column if not exists code text;
alter table luckyduck.events add column if not exists pw_hash text;
alter table luckyduck.events add column if not exists qr_token text;
alter table luckyduck.events add column if not exists control_device text;
alter table luckyduck.events add column if not exists control_name text;
alter table luckyduck.events add column if not exists control_at timestamptz;
create unique index if not exists events_code_uidx on luckyduck.events (code) where code is not null;

create sequence if not exists luckyduck.doc_rev;
create table if not exists luckyduck.docs (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  store text not null check (store in ('participants', 'prizes', 'draws', 'winners', 'audit', 'settings')),
  key text not null check (char_length(key) between 1 and 200),
  data jsonb,
  deleted boolean not null default false,
  rev bigint not null,
  device_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (event_id, store, key)
);
create index if not exists docs_event_rev_idx on luckyduck.docs (event_id, rev);

alter table luckyduck.sessions enable row level security;
alter table luckyduck.docs enable row level security;
revoke all on luckyduck.sessions, luckyduck.docs from public, anon, authenticated;
revoke all on sequence luckyduck.doc_rev from public, anon, authenticated;

-- ---------------------------------------------------------------- pembantu

-- Kunci admin ATAU token sesi yang sah (supaya fungsi kehadiran sedia ada boleh dipanggil dari peranti yang menyertai)
create or replace function luckyduck.assert_admin(p_event uuid, p_key text) returns void
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from luckyduck.events e where e.id = p_event and e.admin_hash = luckyduck.h(p_key)) then return; end if;
  if exists (select 1 from luckyduck.sessions s where s.event_id = p_event and s.token_hash = luckyduck.h(p_key) and s.expires_at > now()) then return; end if;
  raise exception 'FORBIDDEN' using errcode = 'P0001';
end $$;

create or replace function luckyduck.session(p_event uuid, p_session text) returns luckyduck.sessions
language plpgsql set search_path = '' as $$
declare s luckyduck.sessions;
begin
  select * into s from luckyduck.sessions x where x.token_hash = luckyduck.h(p_session) and x.event_id = p_event and x.expires_at > now();
  if not found then raise exception 'SESSION' using errcode = 'P0001'; end if;
  if s.last_seen < now() - interval '1 minute' then
    update luckyduck.sessions x set last_seen = now() where x.token_hash = s.token_hash;
  end if;
  return s;
end $$;

create or replace function luckyduck.new_session(p_event uuid, p_device text, p_name text) returns text
language plpgsql set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if char_length(coalesce(p_device, '')) not between 8 and 64 then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  delete from luckyduck.sessions where expires_at < now();
  insert into luckyduck.sessions (token_hash, event_id, device_id, device_name) values (luckyduck.h(t), p_event, p_device, left(btrim(coalesce(p_name, '')), 80));
  return t;
end $$;

create or replace function luckyduck.meta(p_event uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('event_id', e.id, 'name', e.name, 'code', e.code, 'qr_token', e.qr_token,
    'control_device', e.control_device, 'control_name', e.control_name, 'control_at', e.control_at)
  from luckyduck.events e where e.id = p_event
$$;

create or replace function luckyduck.pw_ok(p text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if char_length(coalesce(p, '')) < 8 or p !~ '[A-Za-z]' or p !~ '[0-9]' then raise exception 'WEAK_PASSWORD' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------- RPC

-- Aktifkan majlis sedia ada sebagai majlis awan (dari laptop yang memegang kunci admin). Peranti ini jadi Peranti Kawalan.
create or replace function public.ldr_cloud_enable(p_event uuid, p_admin_key text, p_password text, p_qr_token text, p_device text, p_device_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; e luckyduck.events; tries int := 0;
begin
  perform luckyduck.throttle('enable:' || luckyduck.client_ip(), 10, 3600);
  if not exists (select 1 from luckyduck.events x where x.id = p_event and x.admin_hash = luckyduck.h(p_admin_key)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform luckyduck.pw_ok(p_password);
  select * into e from luckyduck.events where id = p_event for update;
  if e.token_hash <> luckyduck.h(p_qr_token) then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  v_code := e.code;
  while v_code is null loop
    tries := tries + 1;
    v_code := 'RTD-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
                          from (select extensions.gen_random_bytes(6) b) r, generate_series(0, 5) i);
    if exists (select 1 from luckyduck.events x where x.code = v_code) then v_code := null; end if;
    if tries > 20 then raise exception 'SERVER' using errcode = 'P0001'; end if;
  end loop;
  update luckyduck.events set code = v_code, pw_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    qr_token = p_qr_token, control_device = p_device, control_name = left(btrim(coalesce(p_device_name, '')), 80), control_at = now()
  where id = p_event;
  return luckyduck.meta(p_event) || jsonb_build_object('session', luckyduck.new_session(p_event, p_device, p_device_name));
end $$;

-- Sertai majlis awan dengan kod + kata laluan
create or replace function public.ldr_cloud_join(p_code text, p_password text, p_device text, p_device_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e luckyduck.events;
begin
  perform luckyduck.throttle('join:' || luckyduck.client_ip(), 10, 600);
  select * into e from luckyduck.events x where x.code = upper(btrim(coalesce(p_code, ''))) and x.pw_hash is not null;
  if not found or e.pw_hash <> extensions.crypt(coalesce(p_password, ''), e.pw_hash) then
    raise exception 'BAD_LOGIN' using errcode = 'P0001';
  end if;
  return luckyduck.meta(e.id) || jsonb_build_object('session', luckyduck.new_session(e.id, p_device, p_device_name));
end $$;

-- Hantar perubahan. p_rows: [{s, k, d (jsonb|null), x (deleted bool), b (base_rev)}]
create or replace function public.ldr_cloud_push(p_event uuid, p_session text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ses luckyduck.sessions; is_ctl boolean; r jsonb; cur luckyduck.docs; v_rev bigint;
  applied jsonb := '[]'::jsonb; rejected jsonb := '[]'::jsonb;
begin
  ses := luckyduck.session(p_event, p_session);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  select (e.control_device = ses.device_id) into is_ctl from luckyduck.events e where e.id = p_event;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r ->> 's') not in ('participants', 'prizes', 'draws', 'winners', 'audit', 'settings')
       or char_length(coalesce(r ->> 'k', '')) not between 1 and 200
       or octet_length(coalesce(r -> 'd', 'null'::jsonb)::text) > 1500000 then
      raise exception 'BAD_INPUT' using errcode = 'P0001';
    end if;
    select * into cur from luckyduck.docs d where d.event_id = p_event and d.store = r ->> 's' and d.key = r ->> 'k' for update;
    if found and not coalesce(is_ctl, false) and cur.rev > coalesce((r ->> 'b')::bigint, 0) then
      rejected := rejected || jsonb_build_object('s', cur.store, 'k', cur.key, 'r', cur.rev, 'd', cur.data, 'x', cur.deleted);
      continue;
    end if;
    v_rev := nextval('luckyduck.doc_rev');
    insert into luckyduck.docs as d (event_id, store, key, data, deleted, rev, device_id, updated_at)
    values (p_event, r ->> 's', r ->> 'k', case when coalesce((r ->> 'x')::boolean, false) then null else r -> 'd' end,
            coalesce((r ->> 'x')::boolean, false), v_rev, ses.device_id, now())
    on conflict (event_id, store, key) do update set data = excluded.data, deleted = excluded.deleted, rev = excluded.rev,
      device_id = excluded.device_id, updated_at = now();
    applied := applied || jsonb_build_object('s', r ->> 's', 'k', r ->> 'k', 'r', v_rev);
  end loop;
  return jsonb_build_object('applied', applied, 'rejected', rejected, 'control', coalesce(is_ctl, false));
end $$;

-- Tarik perubahan sejak revisi p_since
create or replace function public.ldr_cloud_pull(p_event uuid, p_session text, p_since bigint, p_limit int default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ses luckyduck.sessions; rows jsonb; n int; lim int := least(greatest(coalesce(p_limit, 1000), 1), 2000);
begin
  ses := luckyduck.session(p_event, p_session);
  select coalesce(jsonb_agg(jsonb_build_object('s', t.store, 'k', t.key, 'r', t.rev, 'd', t.data, 'x', t.deleted) order by t.rev), '[]'::jsonb), count(*)
    into rows, n
  from (select * from luckyduck.docs d where d.event_id = p_event and d.rev > coalesce(p_since, 0) order by d.rev limit lim) t;
  return jsonb_build_object('rows', rows, 'more', n >= lim, 'meta', luckyduck.meta(p_event), 'device', ses.device_id);
end $$;

-- Jadikan peranti ini Peranti Kawalan
create or replace function public.ldr_cloud_claim(p_event uuid, p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ses luckyduck.sessions;
begin
  ses := luckyduck.session(p_event, p_session);
  update luckyduck.events set control_device = ses.device_id, control_name = ses.device_name, control_at = now() where id = p_event;
  return luckyduck.meta(p_event);
end $$;

create or replace function public.ldr_cloud_set_password(p_event uuid, p_session text, p_old text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare e luckyduck.events;
begin
  perform luckyduck.session(p_event, p_session);
  perform luckyduck.throttle('pw:' || luckyduck.client_ip(), 10, 600);
  select * into e from luckyduck.events where id = p_event;
  if e.pw_hash <> extensions.crypt(coalesce(p_old, ''), e.pw_hash) then raise exception 'BAD_LOGIN' using errcode = 'P0001'; end if;
  perform luckyduck.pw_ok(p_new);
  update luckyduck.events set pw_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = p_event;
end $$;

create or replace function public.ldr_cloud_leave(p_event uuid, p_session text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from luckyduck.sessions where token_hash = luckyduck.h(p_session) and event_id = p_event;
end $$;

-- Tukar token QR juga menyimpan token baharu (supaya peranti lain boleh memaparkan QR yang sama)
create or replace function public.ldr_admin_update_event(p_event uuid, p_admin_key text, p_name text default null, p_is_open boolean default null, p_new_token text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  if p_new_token is not null and char_length(p_new_token) < 24 then raise exception 'WEAK_SECRET' using errcode = 'P0001'; end if;
  update luckyduck.events set
    name = coalesce(left(btrim(p_name), 160), name),
    is_open = coalesce(p_is_open, is_open),
    token_hash = case when p_new_token is null then token_hash else luckyduck.h(p_new_token) end,
    qr_token = case when p_new_token is null then qr_token when code is null then null else p_new_token end
  where id = p_event;
end $$;

revoke execute on all functions in schema luckyduck from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'ldr_cloud_enable(uuid,text,text,text,text,text)', 'ldr_cloud_join(text,text,text,text)',
    'ldr_cloud_push(uuid,text,jsonb)', 'ldr_cloud_pull(uuid,text,bigint,int)', 'ldr_cloud_claim(uuid,text)',
    'ldr_cloud_set_password(uuid,text,text,text)', 'ldr_cloud_leave(uuid,text)',
    'ldr_admin_update_event(uuid,text,text,boolean,text)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

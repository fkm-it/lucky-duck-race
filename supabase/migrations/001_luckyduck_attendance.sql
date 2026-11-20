-- Lucky Duck Race — modul pengesahan kehadiran (QR).
-- Jadual dalam skema `luckyduck` (TIDAK didedahkan melalui API). Semua akses melalui fungsi RPC
-- SECURITY DEFINER dalam `public` dengan awalan ldr_, yang mengesahkan token majlis / kunci admin.

create schema if not exists luckyduck;
revoke all on schema luckyduck from public, anon, authenticated;

create table if not exists luckyduck.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  token_hash text not null,          -- sha256(token dalam QR)
  admin_hash text not null,          -- sha256(kunci admin laptop)
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists luckyduck.staff (
  event_id uuid not null references luckyduck.events(id) on delete cascade,
  staff_id text not null check (char_length(staff_id) between 1 and 40),  -- TEKS (sifar di hadapan kekal)
  name text not null check (char_length(name) between 1 and 120),
  department text not null default '' check (char_length(department) <= 120),
  checked_in_at timestamptz,
  checked_in_via text check (checked_in_via in ('qr', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (event_id, staff_id)
);
create index if not exists staff_event_checkin_idx on luckyduck.staff (event_id, checked_in_at) where checked_in_at is not null;
create index if not exists staff_event_updated_idx on luckyduck.staff (event_id, updated_at);

create table if not exists luckyduck.rate (
  bucket text not null,
  at timestamptz not null default now()
);
create index if not exists rate_bucket_at_idx on luckyduck.rate (bucket, at);

alter table luckyduck.events enable row level security;
alter table luckyduck.staff enable row level security;
alter table luckyduck.rate enable row level security;
revoke all on all tables in schema luckyduck from public, anon, authenticated;

-- ---------------------------------------------------------------- pembantu (tidak boleh dipanggil dari API)

create or replace function luckyduck.h(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function luckyduck.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), 'unknown')
$$;

-- Had kadar: maks p_max panggilan per p_secs bagi satu baldi (IP + tindakan)
create or replace function luckyduck.throttle(p_bucket text, p_max int, p_secs int) returns void
language plpgsql set search_path = '' as $$
declare n int;
begin
  delete from luckyduck.rate where at < now() - interval '1 hour';
  select count(*) into n from luckyduck.rate where bucket = p_bucket and at > now() - make_interval(secs => p_secs);
  if n >= p_max then raise exception 'RATE_LIMIT' using errcode = 'P0001', hint = 'Terlalu banyak cubaan. Tunggu sebentar.'; end if;
  insert into luckyduck.rate (bucket) values (p_bucket);
end $$;

create or replace function luckyduck.norm_id(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))
$$;

create or replace function luckyduck.assert_admin(p_event uuid, p_key text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from luckyduck.events e where e.id = p_event and e.admin_hash = luckyduck.h(p_key)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
end $$;

create or replace function luckyduck.assert_token(p_event uuid, p_token text) returns luckyduck.events
language plpgsql set search_path = '' as $$
declare e luckyduck.events;
begin
  select * into e from luckyduck.events where id = p_event and token_hash = luckyduck.h(p_token);
  if not found then raise exception 'INVALID_QR' using errcode = 'P0001'; end if;
  if not e.is_open then raise exception 'CLOSED' using errcode = 'P0001'; end if;
  return e;
end $$;

-- ---------------------------------------------------------------- RPC admin (laptop)

create or replace function public.ldr_create_event(p_name text, p_token text, p_admin_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform luckyduck.throttle('create:' || luckyduck.client_ip(), 5, 3600);
  if char_length(coalesce(p_token, '')) < 24 or char_length(coalesce(p_admin_key, '')) < 32 then raise exception 'WEAK_SECRET' using errcode = 'P0001'; end if;
  insert into luckyduck.events (name, token_hash, admin_hash)
  values (left(btrim(p_name), 160), luckyduck.h(p_token), luckyduck.h(p_admin_key)) returning id into v;
  return v;
end $$;

create or replace function public.ldr_admin_update_event(p_event uuid, p_admin_key text, p_name text default null, p_is_open boolean default null, p_new_token text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  if p_new_token is not null and char_length(p_new_token) < 24 then raise exception 'WEAK_SECRET' using errcode = 'P0001'; end if;
  update luckyduck.events set
    name = coalesce(left(btrim(p_name), 160), name),
    is_open = coalesce(p_is_open, is_open),
    token_hash = case when p_new_token is null then token_hash else luckyduck.h(p_new_token) end
  where id = p_event;
end $$;

-- Muat naik / kemas kini senarai staf: [{staff_id, name, department}] — status kehadiran dikekalkan
create or replace function public.ldr_admin_upsert_staff(p_event uuid, p_admin_key text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'BAD_INPUT' using errcode = 'P0001'; end if;
  insert into luckyduck.staff as s (event_id, staff_id, name, department)
  select p_event, luckyduck.norm_id(r ->> 'staff_id'), left(btrim(r ->> 'name'), 120), left(btrim(coalesce(r ->> 'department', '')), 120)
  from jsonb_array_elements(p_rows) r
  where luckyduck.norm_id(r ->> 'staff_id') <> '' and btrim(coalesce(r ->> 'name', '')) <> ''
  on conflict (event_id, staff_id) do update set name = excluded.name, department = excluded.department, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ldr_admin_delete_staff(p_event uuid, p_admin_key text, p_staff_ids text[])
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  if p_staff_ids is null then delete from luckyduck.staff where event_id = p_event;
  else delete from luckyduck.staff where event_id = p_event and staff_id = any (p_staff_ids); end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Senarai penuh (atau yang berubah sejak p_since) untuk penyegerakan laptop
create or replace function public.ldr_admin_list(p_event uuid, p_admin_key text, p_since timestamptz default null)
returns table (staff_id text, name text, department text, checked_in_at timestamptz, checked_in_via text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  return query select s.staff_id, s.name, s.department, s.checked_in_at, s.checked_in_via, s.updated_at
    from luckyduck.staff s where s.event_id = p_event and (p_since is null or s.updated_at > p_since)
    order by s.updated_at;
end $$;

create or replace function public.ldr_admin_event(p_event uuid, p_admin_key text)
returns table (name text, is_open boolean, total bigint, present bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  return query select e.name, e.is_open,
    (select count(*) from luckyduck.staff s where s.event_id = e.id),
    (select count(*) from luckyduck.staff s where s.event_id = e.id and s.checked_in_at is not null)
  from luckyduck.events e where e.id = p_event;
end $$;

-- Sahkan / batal secara manual di kaunter
create or replace function public.ldr_admin_set_checkin(p_event uuid, p_admin_key text, p_staff_id text, p_present boolean)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v timestamptz;
begin
  perform luckyduck.assert_admin(p_event, p_admin_key);
  update luckyduck.staff s set
    checked_in_at = case when p_present then coalesce(s.checked_in_at, now()) else null end,
    checked_in_via = case when p_present then coalesce(s.checked_in_via, 'manual') else null end,
    updated_at = now()
  where s.event_id = p_event and s.staff_id = luckyduck.norm_id(p_staff_id)
  returning s.checked_in_at into v;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- RPC awam (telefon staf, perlu token QR)

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
  return query select s.staff_id, s.name, s.department, s.checked_in_at from luckyduck.staff s
    where s.event_id = p_event and s.staff_id = luckyduck.norm_id(p_staff_id);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
end $$;

create or replace function public.ldr_checkin(p_event uuid, p_token text, p_staff_id text)
returns table (staff_id text, name text, department text, checked_in_at timestamptz, already boolean)
language plpgsql security definer set search_path = '' as $$
declare s luckyduck.staff; v_already boolean;
begin
  perform luckyduck.throttle('checkin:' || luckyduck.client_ip(), 20, 60);
  perform luckyduck.assert_token(p_event, p_token);
  select * into s from luckyduck.staff x where x.event_id = p_event and x.staff_id = luckyduck.norm_id(p_staff_id) for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  v_already := s.checked_in_at is not null;
  if not v_already then
    update luckyduck.staff x set checked_in_at = now(), checked_in_via = 'qr', updated_at = now()
    where x.event_id = p_event and x.staff_id = s.staff_id returning * into s;
  end if;
  return query select s.staff_id, s.name, s.department, s.checked_in_at, v_already;
end $$;

-- ---------------------------------------------------------------- kebenaran

revoke execute on all functions in schema luckyduck from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'ldr_create_event(text,text,text)', 'ldr_admin_update_event(uuid,text,text,boolean,text)',
    'ldr_admin_upsert_staff(uuid,text,jsonb)', 'ldr_admin_delete_staff(uuid,text,text[])',
    'ldr_admin_list(uuid,text,timestamptz)', 'ldr_admin_event(uuid,text)', 'ldr_admin_set_checkin(uuid,text,text,boolean)',
    'ldr_event_info(uuid,text)', 'ldr_lookup(uuid,text,text)', 'ldr_checkin(uuid,text,text)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- SAIC Farmer Registry — database setup (SAIC TRC 01, forms F01 A and B)
-- Run once in Supabase: SQL Editor → New query → paste everything → Run.
-- Safe to run again: it only creates what is missing.
-- =====================================================================

-- ---------- Roles -----------------------------------------------------
-- lead       = Traceability Lead: everything, including review decisions and team roles
-- warehouse  = Warehouse Manager: registers and edits farmers and plots
-- viewer     = read only (default for any new account)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'viewer' check (role in ('lead','warehouse','viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles for users created before this script ran
insert into public.profiles (id, full_name)
select id, split_part(email,'@',1) from auth.users on conflict (id) do nothing;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- Farmers (F01 Sheet A) --------------------------------------
create sequence if not exists public.farmer_seq start 1;

create table if not exists public.farmers (
  id text primary key default ('F' || lpad(nextval('public.farmer_seq')::text, 4, '0')),
  supplier_id text, type text default 'Farmer', name text not null, gender text, aliases text,
  village text not null, address text, phone text, email text,
  id_type text, id_number text, id_validity date, id_viewed_on date, id_checked_by text, id_verif_ref text,
  niu text, representative text,
  confirm_date date, officer text, record_ref text,
  chk_identity boolean not null default false, chk_rep boolean not null default false, chk_plots boolean not null default false,
  issues text, reviewer text, decision text check (decision in ('Approved','Hold','Rejected')), decision_date date,
  photo_path text,
  archived boolean not null default false, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);

-- ---------- Plots (F01 Sheet B) ----------------------------------------
create table if not exists public.plots (
  id uuid primary key default gen_random_uuid(),
  farmer_id text not null references public.farmers(id) on delete restrict,
  pid text not null check (pid ~ '^P[0-9]{2,3}$'),
  producer text, country text default 'Cameroon', region text, department text, arrondissement text, village text,
  area numeric, harvest text, expected_kg numeric, est_basis text,
  lat text check (lat is null or lat ~ '^-?[0-9]+(\.[0-9]+)?$'),
  lon text check (lon is null or lon ~ '^-?[0-9]+(\.[0-9]+)?$'),
  polygon jsonb,
  file_name text, file_version text, map_date date, provider text,
  right_evidence text, link_evidence text, overlap_ref text,
  defo_evidence text, defo_date date, legal_evidence text, legal_date date,
  chk_format boolean not null default false, chk_link boolean not null default false, chk_risk boolean not null default false,
  concerns text, reviewer text, decision text check (decision in ('Approved','Hold','Rejected')), decision_date date, next_check text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
  unique (farmer_id, pid)
);
create index if not exists plots_farmer_idx on public.plots(farmer_id);

-- ---------- Guard rails ------------------------------------------------
-- stamp who changed what, and keep review decisions for the Traceability Lead only
create or replace function public.guard_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'lead' then
    if tg_op = 'INSERT' and (new.decision is not null or new.reviewer is not null or new.decision_date is not null) then
      raise exception 'Only the Traceability Lead can record a review decision';
    end if;
    if tg_op = 'UPDATE' and (new.decision is distinct from old.decision or new.reviewer is distinct from old.reviewer or new.decision_date is distinct from old.decision_date) then
      raise exception 'Only the Traceability Lead can record a review decision';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id then raise exception 'IDs are permanent and cannot be changed'; end if;
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists farmers_guard on public.farmers;
create trigger farmers_guard before insert or update on public.farmers for each row execute function public.guard_record();
drop trigger if exists plots_guard on public.plots;
create trigger plots_guard before insert or update on public.plots for each row execute function public.guard_record();

-- ---------- Change log (manual: keep the previous value and a dated change log) ----
create table if not exists public.change_log (
  id bigint generated always as identity primary key,
  farmer_id text not null,
  table_name text not null,
  record_label text,
  action text not null,
  changes jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists change_log_farmer_idx on public.change_log(farmer_id, changed_at desc);

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb; fid text; lbl text;
begin
  if tg_table_name = 'farmers' then fid := new.id; lbl := new.id;
  else fid := new.farmer_id; lbl := new.farmer_id || ' ' || new.pid; end if;
  if tg_op = 'INSERT' then
    insert into public.change_log(farmer_id, table_name, record_label, action, changes, changed_by)
    values (fid, tg_table_name, lbl, 'created', null, auth.uid());
  else
    select jsonb_object_agg(n.key, jsonb_build_array(to_jsonb(old)->n.key, n.value)) into d
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('updated_at','updated_by') and n.value is distinct from (to_jsonb(old)->n.key);
    if d is not null then
      insert into public.change_log(farmer_id, table_name, record_label, action, changes, changed_by)
      values (fid, tg_table_name, lbl, 'updated', d, auth.uid());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists farmers_log on public.farmers;
create trigger farmers_log after insert or update on public.farmers for each row execute function public.log_change();
drop trigger if exists plots_log on public.plots;
create trigger plots_log after insert or update on public.plots for each row execute function public.log_change();

-- ---------- Row level security ----------------------------------------
alter table public.profiles enable row level security;
alter table public.farmers enable row level security;
alter table public.plots enable row level security;
alter table public.change_log enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles lead manages" on public.profiles;
create policy "profiles lead manages" on public.profiles for update to authenticated
  using (public.app_role() = 'lead') with check (public.app_role() = 'lead');

drop policy if exists "farmers read" on public.farmers;
create policy "farmers read" on public.farmers for select to authenticated using (public.app_role() is not null);
drop policy if exists "farmers insert" on public.farmers;
create policy "farmers insert" on public.farmers for insert to authenticated with check (public.app_role() in ('lead','warehouse'));
drop policy if exists "farmers update" on public.farmers;
create policy "farmers update" on public.farmers for update to authenticated
  using (public.app_role() in ('lead','warehouse')) with check (public.app_role() in ('lead','warehouse'));
-- no delete policy: records are archived, never deleted

drop policy if exists "plots read" on public.plots;
create policy "plots read" on public.plots for select to authenticated using (public.app_role() is not null);
drop policy if exists "plots insert" on public.plots;
create policy "plots insert" on public.plots for insert to authenticated with check (public.app_role() in ('lead','warehouse'));
drop policy if exists "plots update" on public.plots;
create policy "plots update" on public.plots for update to authenticated
  using (public.app_role() in ('lead','warehouse')) with check (public.app_role() in ('lead','warehouse'));

drop policy if exists "log read" on public.change_log;
create policy "log read" on public.change_log for select to authenticated using (public.app_role() is not null);
-- the log is written only by the trigger; nobody can edit or delete it from the app

revoke delete on public.farmers, public.plots, public.change_log from anon, authenticated;
revoke insert, update on public.change_log from anon, authenticated;

-- ---------- Photo storage ----------------------------------------------
insert into storage.buckets (id, name, public) values ('farmer-photos','farmer-photos', false)
on conflict (id) do nothing;

drop policy if exists "photos read" on storage.objects;
create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'farmer-photos' and public.app_role() is not null);
drop policy if exists "photos write" on storage.objects;
create policy "photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'farmer-photos' and public.app_role() in ('lead','warehouse'));
drop policy if exists "photos replace" on storage.objects;
create policy "photos replace" on storage.objects for update to authenticated
  using (bucket_id = 'farmer-photos' and public.app_role() in ('lead','warehouse'));

-- =====================================================================
-- After running: make yourself the Traceability Lead (replace the email):
--   update public.profiles set role = 'lead'
--   where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================

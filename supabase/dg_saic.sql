-- =====================================================================
-- SAIC — DG SAIC dashboard (/dg-saic)
-- Run AFTER schema.sql, treasury.sql, pdg.sql and reception.sql. Safe to run again.
--
-- The DG SAIC (exec_members.role = 'dg_saic') manages SAIC Cacao and SAIC Industries:
--   * sees every SAIC app (registry, treasury, cocoa reception), read only;
--   * receives requests from SAIC staff and decides on them
--     (approve, reject, ask for information, or forward to the PDG);
--   * submits her own requests to the PDG (table pdg_requests, from pdg.sql).
-- =====================================================================

create or replace function public.is_dg_saic() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.exec_role() = 'dg_saic', false)
$$;

-- ---------- SAIC staff who can send requests to the DG ----------
-- entity: 'cacao' (SAIC Cacao) or 'industries' (SAIC Industries). The DG manages this list from the Team page.
create table if not exists public.saic_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entity text not null check (entity in ('cacao','industries')),
  department text not null default '',
  title text not null default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.saic_staff enable row level security;
drop policy if exists "staff read" on public.saic_staff;
create policy "staff read" on public.saic_staff for select to authenticated using (user_id = auth.uid() or public.is_dg_saic() or public.is_pdg());
drop policy if exists "staff dg insert" on public.saic_staff;
create policy "staff dg insert" on public.saic_staff for insert to authenticated with check (public.is_dg_saic());
drop policy if exists "staff dg update" on public.saic_staff;
create policy "staff dg update" on public.saic_staff for update to authenticated using (public.is_dg_saic()) with check (public.is_dg_saic());
revoke delete on public.saic_staff from anon, authenticated;   -- deactivate instead of deleting

-- Who may send a request to the DG, and for which entity:
-- listed staff (active), otherwise anyone with a registry role (lead, warehouse) or a treasury role → SAIC Cacao.
create or replace function public.saic_submitter() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select entity from public.saic_staff where user_id = auth.uid() and active),
    case when public.app_role() in ('lead','warehouse') or public.treasury_role() is not null then 'cacao' end)
$$;

-- ---------- The DG reads every SAIC app (approvals inside each app stay where they are) ----------
drop policy if exists "dg read" on public.farmers;           create policy "dg read" on public.farmers           for select to authenticated using (public.is_dg_saic());
drop policy if exists "dg read" on public.plots;             create policy "dg read" on public.plots             for select to authenticated using (public.is_dg_saic());
drop policy if exists "dg read" on public.cash_boxes;        create policy "dg read" on public.cash_boxes        for select to authenticated using (public.is_dg_saic());
drop policy if exists "dg read" on public.cash_transactions; create policy "dg read" on public.cash_transactions for select to authenticated using (public.is_dg_saic());
drop policy if exists "dg read" on public.fund_requests;     create policy "dg read" on public.fund_requests     for select to authenticated using (public.is_dg_saic());
drop policy if exists "dg read" on public.cocoa_receptions;  create policy "dg read" on public.cocoa_receptions  for select to authenticated using (public.is_dg_saic());
drop policy if exists "dg read" on public.cocoa_sales;       create policy "dg read" on public.cocoa_sales       for select to authenticated using (public.is_dg_saic());

-- ---------- Requests to the DG SAIC ----------
create table if not exists public.dg_requests (
  id text primary key,
  entity text not null check (entity in ('cacao','industries')),
  department text not null default '',
  from_user uuid default auth.uid(),
  from_name text not null default '',
  type text not null check (type in ('depense','achat','budget','contrat','recrutement','conge','maintenance','autre')),
  title text not null,
  amount numeric not null default 0 check (amount >= 0),
  urgency text not null default 'normal' check (urgency in ('normal','urgent')),
  due date,
  details text not null,
  files jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','info','approved','rejected','escalated')),
  last_note text,
  pdg_ref text references public.pdg_requests(id),
  example boolean not null default false,
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.guard_dg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := public.saic_submitter(); dg boolean := public.is_dg_saic(); nm text;
begin
  if auth.uid() is null then return new; end if;   -- setup from the SQL Editor
  if tg_op = 'INSERT' then
    if ent is null or dg then raise exception 'Only SAIC staff send requests to the DG SAIC'; end if;
    select coalesce(full_name, '') into nm from public.profiles where id = auth.uid();
    new.from_user := auth.uid(); new.from_name := coalesce(nm, '');
    if not exists (select 1 from public.saic_staff where user_id = auth.uid() and active) then new.entity := ent; end if;
    if exists (select 1 from public.saic_staff where user_id = auth.uid() and active) then
      select entity, case when new.department = '' then department else new.department end into new.entity, new.department
      from public.saic_staff where user_id = auth.uid();
    end if;
    new.status := 'pending'; new.example := false; new.pdg_ref := null; new.last_note := null; new.created_at := now();
    new.history := jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'role', 'staff', 'name', new.from_name, 'action', 'submitted'));
    return new;
  end if;
  if new.entity <> old.entity or new.department <> old.department or new.type <> old.type or new.title <> old.title or new.amount <> old.amount
     or new.details <> old.details or new.from_user is distinct from old.from_user or new.from_name <> old.from_name or new.example <> old.example then
    raise exception 'A submitted request cannot be edited';
  end if;
  if dg then
    if old.status <> 'pending' then raise exception 'This request is not waiting for a decision'; end if;
    if new.status not in ('approved','rejected','info','escalated') then raise exception 'Invalid decision'; end if;
    if new.status in ('rejected','info') and coalesce(trim(new.last_note),'') = '' then raise exception 'Add a reason or a question'; end if;
    if new.status = 'escalated' then
      if new.pdg_ref is null or not exists (select 1 from public.pdg_requests where id = new.pdg_ref and from_role = 'dg_saic') then
        raise exception 'Forward the request to the PDG first';
      end if;
    else
      new.pdg_ref := old.pdg_ref;
    end if;
    new.files := old.files;
  elsif auth.uid() = old.from_user then
    if old.status <> 'info' or new.status <> 'pending' then raise exception 'You can only answer a question from the DG'; end if;
    if coalesce(trim(new.last_note),'') = '' then raise exception 'Write your answer'; end if;
    new.pdg_ref := old.pdg_ref;
  else
    raise exception 'Not allowed';
  end if;
  new.history := old.history || jsonb_build_object('at', now(), 'by', auth.uid(), 'role', case when dg then 'dg_saic' else 'staff' end,
    'action', case when dg then new.status else 'reply' end, 'note', nullif(trim(new.last_note),''), 'pdg_ref', new.pdg_ref);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dg_req_guard on public.dg_requests;
create trigger dg_req_guard before insert or update on public.dg_requests for each row execute function public.guard_dg_request();

alter table public.dg_requests enable row level security;
drop policy if exists "dgreq read" on public.dg_requests;
create policy "dgreq read" on public.dg_requests for select to authenticated using (public.is_dg_saic() or public.is_pdg() or from_user = auth.uid());
drop policy if exists "dgreq insert" on public.dg_requests;
create policy "dgreq insert" on public.dg_requests for insert to authenticated with check (public.saic_submitter() is not null and not public.is_dg_saic());
drop policy if exists "dgreq update" on public.dg_requests;
create policy "dgreq update" on public.dg_requests for update to authenticated using (public.is_dg_saic() or from_user = auth.uid()) with check (public.is_dg_saic() or from_user = auth.uid());
revoke delete on public.dg_requests from anon, authenticated;

-- ---------- Attachments (each person uploads into a folder named after their user id) ----------
insert into storage.buckets (id, name, public) values ('dg-files','dg-files', false) on conflict (id) do nothing;
drop policy if exists "dgfiles read" on storage.objects;
create policy "dgfiles read" on storage.objects for select to authenticated
  using (bucket_id = 'dg-files' and (public.is_dg_saic() or public.is_pdg() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "dgfiles write" on storage.objects;
create policy "dgfiles write" on storage.objects for insert to authenticated
  with check (bucket_id = 'dg-files' and public.saic_submitter() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "dg saic files read" on storage.objects;
create policy "dg saic files read" on storage.objects for select to authenticated
  using (bucket_id in ('treasury-files','farmer-photos','reception-files') and public.is_dg_saic());

-- ---------- Example requests (marked "Example") ----------
insert into public.dg_requests (id, entity, department, from_name, type, title, amount, urgency, due, details, status, example, created_at, history) values
 ('DG-2026-EX001','cacao','Magasin','Magasinier (exemple)','maintenance','Réparation de la bascule du magasin de Mfou',350000,'urgent','2026-11-21',
  'La bascule principale affiche un écart de 2 kg sur les sacs de contrôle. Devis du réparateur agréé joint.',
  'pending', true, '2026-11-17T07:30:00Z', '[{"at":"2026-11-17T07:30:00Z","role":"staff","name":"Magasinier (exemple)","action":"submitted"}]'),
 ('DG-2026-EX002','industries','Production','Chef de production (exemple)','achat','Pièces de rechange pour la ligne de production',2400000,'normal','2026-11-28',
  'Remplacement des roulements et courroies avant la reprise de la production. Deux devis comparés.',
  'pending', true, '2026-11-16T14:00:00Z', '[{"at":"2026-11-16T14:00:00Z","role":"staff","name":"Chef de production (exemple)","action":"submitted"}]'),
 ('DG-2026-EX003','cacao','Comptabilité','Comptable (exemple)','depense','Frais de mission des acheteurs, zone Lékié',180000,'normal',null,
  'Hébergement et carburant pour 3 acheteurs pendant 4 jours.',
  'info', true, '2026-11-15T09:00:00Z', '[{"at":"2026-11-15T09:00:00Z","role":"staff","name":"Comptable (exemple)","action":"submitted"},{"at":"2026-11-15T16:00:00Z","role":"dg_saic","action":"info","note":"Merci de joindre le programme de mission et les volumes attendus."}]')
on conflict (id) do nothing;

-- =====================================================================
-- Then:
-- 1. Make sure the DG SAIC has her role (replace the email):
--      insert into public.exec_members (user_id, role)
--      select id, 'dg_saic' from auth.users where email = 'dg.saic@example.com'
--      on conflict (user_id) do update set role = excluded.role;
-- 2. The DG adds SAIC Cacao and SAIC Industries staff from /dg-saic → Team.
--    People with a registry or treasury role can already send requests (as SAIC Cacao).
-- =====================================================================

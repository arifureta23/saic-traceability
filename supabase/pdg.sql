-- =====================================================================
-- WHP — PDG dashboard (/pdg)
-- Run AFTER schema.sql (registry) and treasury.sql. Safe to run again.
-- =====================================================================

-- ---------- Roles ----------
-- pdg     = PDG of Wenkam Holding Plus: sees every app, decides on requests
-- dg_whp  = Managing Director, WHP      ┐
-- daf_whp = Finance Director, WHP       ├ submit requests to the PDG and follow them
-- dg_saic = Managing Director, SAIC     ┘
create table if not exists public.exec_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('pdg','dg_whp','daf_whp','dg_saic')),
  updated_at timestamptz not null default now()
);
create or replace function public.exec_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.exec_members where user_id = auth.uid()
$$;
create or replace function public.is_pdg() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.exec_role() = 'pdg', false)
$$;
alter table public.exec_members enable row level security;
drop policy if exists "exec read" on public.exec_members;
create policy "exec read" on public.exec_members for select to authenticated using (user_id = auth.uid() or public.is_pdg());
revoke insert, update, delete on public.exec_members from anon, authenticated;   -- roles are set from the SQL Editor

-- ---------- The PDG reads every app (read only: approvals inside each app stay with their owners) ----------
drop policy if exists "pdg read" on public.farmers;           create policy "pdg read" on public.farmers           for select to authenticated using (public.is_pdg());
drop policy if exists "pdg read" on public.plots;             create policy "pdg read" on public.plots             for select to authenticated using (public.is_pdg());
drop policy if exists "pdg read" on public.change_log;        create policy "pdg read" on public.change_log        for select to authenticated using (public.is_pdg());
drop policy if exists "pdg read" on public.cash_boxes;        create policy "pdg read" on public.cash_boxes        for select to authenticated using (public.is_pdg());
drop policy if exists "pdg read" on public.cash_transactions; create policy "pdg read" on public.cash_transactions for select to authenticated using (public.is_pdg());
drop policy if exists "pdg read" on public.fund_requests;     create policy "pdg read" on public.fund_requests     for select to authenticated using (public.is_pdg());
drop policy if exists "pdg read" on public.treasury_log;      create policy "pdg read" on public.treasury_log      for select to authenticated using (public.is_pdg());

-- ---------- Requests to the PDG ----------
create table if not exists public.pdg_requests (
  id text primary key,
  from_role text not null check (from_role in ('dg_whp','daf_whp','dg_saic')),
  ent text not null check (ent in ('WHP','SAIC')),
  type text not null check (type in ('depense','budget','contrat','investissement','recrutement','autre')),
  title text not null,
  amount numeric not null default 0 check (amount >= 0),
  urgency text not null default 'normal' check (urgency in ('normal','urgent')),
  due date,
  details text not null,
  files jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','info','approved','rejected')),
  last_note text,
  example boolean not null default false,
  history jsonb not null default '[]',
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function public.guard_pdg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.exec_role();
begin
  if auth.uid() is null then return new; end if;   -- setup from the SQL Editor
  if tg_op = 'INSERT' then
    if r not in ('dg_whp','daf_whp','dg_saic') or r is null then raise exception 'Only the DG WHP, the DAF WHP and the DG SAIC submit requests to the PDG'; end if;
    new.from_role := r; new.status := 'pending'; new.example := false; new.created_by := auth.uid(); new.created_at := now();
    new.history := jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'role', r, 'action', 'submitted'));
    new.last_note := null;
    return new;
  end if;
  if new.from_role <> old.from_role or new.ent <> old.ent or new.type <> old.type or new.title <> old.title or new.amount <> old.amount
     or new.details <> old.details or new.created_by is distinct from old.created_by or new.example <> old.example then
    raise exception 'A submitted request cannot be edited';
  end if;
  if r = 'pdg' then
    if old.status <> 'pending' then raise exception 'This request is not waiting for a decision'; end if;
    if new.status not in ('approved','rejected','info') then raise exception 'Invalid decision'; end if;
    if new.status in ('rejected','info') and coalesce(trim(new.last_note),'') = '' then raise exception 'Add a reason or a question'; end if;
    new.files := old.files;
  elsif r = old.from_role then
    if old.status <> 'info' or new.status <> 'pending' then raise exception 'You can only answer a question from the PDG'; end if;
    if coalesce(trim(new.last_note),'') = '' then raise exception 'Write your answer'; end if;
  else
    raise exception 'Not allowed';
  end if;
  new.history := old.history || jsonb_build_object('at', now(), 'by', auth.uid(), 'role', r,
    'action', case when r = 'pdg' then new.status else 'reply' end, 'note', nullif(trim(new.last_note),''));
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pdg_req_guard on public.pdg_requests;
create trigger pdg_req_guard before insert or update on public.pdg_requests for each row execute function public.guard_pdg_request();

alter table public.pdg_requests enable row level security;
drop policy if exists "pdgreq read" on public.pdg_requests;
create policy "pdgreq read" on public.pdg_requests for select to authenticated using (public.is_pdg() or from_role = public.exec_role());
drop policy if exists "pdgreq insert" on public.pdg_requests;
create policy "pdgreq insert" on public.pdg_requests for insert to authenticated with check (public.exec_role() in ('dg_whp','daf_whp','dg_saic'));
drop policy if exists "pdgreq update" on public.pdg_requests;
create policy "pdgreq update" on public.pdg_requests for update to authenticated using (public.is_pdg() or from_role = public.exec_role()) with check (public.is_pdg() or from_role = public.exec_role());
revoke delete on public.pdg_requests from anon, authenticated;

-- ---------- Attachments ----------
insert into storage.buckets (id, name, public) values ('pdg-files','pdg-files', false) on conflict (id) do nothing;
drop policy if exists "pdgfiles read" on storage.objects;
create policy "pdgfiles read" on storage.objects for select to authenticated using (bucket_id = 'pdg-files' and public.exec_role() is not null);
drop policy if exists "pdgfiles write" on storage.objects;
create policy "pdgfiles write" on storage.objects for insert to authenticated with check (bucket_id = 'pdg-files' and public.exec_role() in ('dg_whp','daf_whp','dg_saic'));
drop policy if exists "pdg files read" on storage.objects;
create policy "pdg files read" on storage.objects for select to authenticated using (bucket_id in ('treasury-files','farmer-photos') and public.is_pdg());

-- ---------- Example requests (marked "Example") ----------
insert into public.pdg_requests (id, from_role, ent, type, title, amount, urgency, due, details, status, example, created_at, created_by, history) values
 ('PDG-2026-EX001','dg_saic','SAIC','investissement','Achat d''un pickup pour la collecte à Mfou',18500000,'urgent','2026-11-20',
  'Le pickup Ce014LN a coûté 226 000 F de réparations en deux semaines. Proposition : achat d''un pickup d''occasion (devis joint, 2 fournisseurs consultés).',
  'pending', true, '2026-11-16T08:00:00Z', null, '[{"at":"2026-11-16T08:00:00Z","role":"dg_saic","action":"submitted"}]'),
 ('PDG-2026-EX002','daf_whp','WHP','budget','Budget de fonctionnement WHP, décembre 2026',12000000,'normal','2026-11-28',
  'Budget mensuel : salaires, loyers, missions. Détail par poste en pièce jointe.',
  'pending', true, '2026-11-15T15:30:00Z', null, '[{"at":"2026-11-15T15:30:00Z","role":"daf_whp","action":"submitted"}]'),
 ('PDG-2026-EX003','dg_whp','WHP','contrat','Contrat de transport avec MOON Ltd pour la campagne 2026/2027',0,'normal',null,
  'Renouvellement du contrat-cadre, mêmes tarifs que la campagne précédente.',
  'info', true, '2026-11-13T10:00:00Z', null, '[{"at":"2026-11-13T10:00:00Z","role":"dg_whp","action":"submitted"},{"at":"2026-11-14T09:00:00Z","role":"pdg","action":"info","note":"Quel volume de cacao est prévu ? Joindre la comparaison avec un autre transporteur."}]')
on conflict (id) do nothing;

-- =====================================================================
-- Then give each person their role (replace the emails):
--   insert into public.exec_members (user_id, role)
--   select id, 'pdg' from auth.users where email = 'pdg@example.com'
--   on conflict (user_id) do update set role = excluded.role;
-- Roles: 'pdg', 'dg_whp', 'daf_whp', 'dg_saic'.
-- =====================================================================

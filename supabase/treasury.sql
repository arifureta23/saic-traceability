-- =====================================================================
-- SAIC Trésorerie — database setup (Manuel des procédures de trésorerie 2026/2027)
-- Run once in Supabase: SQL Editor → New query → paste everything → Run.
-- Uses the same project and logins as the farmer registry.
-- =====================================================================

-- ---------- Treasury roles (separate from the registry roles) ----------
-- Each role has its own dashboard (since Nov 2026 the single /tresorerie app is replaced by four):
-- caisse_cacao = Caisse Achat Cacao (/caisse-cacao): records, edits and requests funds for the cocoa box only
-- caisse_admin = Caisse Administrative (/caisse-admin): same, for the admin box only
-- comptable    = Accountant (/comptable): reads both boxes, asks questions; cannot record or request
-- daf          = DAF (/daf): approves top-ups, manages treasury roles and cash box ceilings, answers questions
-- dg           = General Management: approves exceptional top-ups (from the DAF dashboard)
-- tresorier    = Treasurer: records the bank transfer when a top-up is funded (from the DAF dashboard)
-- viewer       = read only (from the DAF dashboard)
create table if not exists public.treasury_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  updated_at timestamptz not null default now()
);
alter table public.treasury_members drop constraint if exists treasury_members_role_check;
alter table public.treasury_members add constraint treasury_members_role_check
  check (role in ('caisse_cacao','caisse_admin','comptable','daf','dg','tresorier','viewer'));
create or replace function public.treasury_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.treasury_members where user_id = auth.uid()
$$;
-- the cash box a cash box manager works on ('cacao' / 'admin'), null for every other role
create or replace function public.treasury_box() returns text
language sql stable security definer set search_path = public as $$
  select case role when 'caisse_cacao' then 'cacao' when 'caisse_admin' then 'admin' end
  from public.treasury_members where user_id = auth.uid()
$$;
-- may the signed-in person see this cash box? Cash box managers only see their own.
create or replace function public.treasury_sees(p_box text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('comptable','daf','dg','tresorier','viewer')
                       or (role = 'caisse_cacao' and p_box = 'cacao')
                       or (role = 'caisse_admin' and p_box = 'admin')
                   from public.treasury_members where user_id = auth.uid()), false)
$$;

-- ---------- Cash boxes ----------
create table if not exists public.cash_boxes (
  id text primary key check (id in ('cacao','admin')),
  code text not null,
  opening numeric not null default 0,
  start_date date not null,
  ceiling numeric not null,
  target numeric not null
);
insert into public.cash_boxes (id, code, opening, start_date, ceiling, target) values
  ('cacao','COC', 4397425, '2026-10-01', 20000000, 20000000),
  ('admin','CAD', 17400,   '2026-11-02', 500000,   500000)
on conflict (id) do nothing;
-- reason given with each ceiling / target change (kept in treasury_log)
alter table public.cash_boxes add column if not exists change_reason text;
create or replace function public.guard_cash_box() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id then raise exception 'A cash box cannot be renamed'; end if;
  if auth.uid() is not null and (new.ceiling, new.target, new.opening, new.start_date) is distinct from (old.ceiling, old.target, old.opening, old.start_date)
     and (coalesce(trim(new.change_reason),'') = '' or new.change_reason is not distinct from old.change_reason) then
    raise exception 'Give a reason for this change';
  end if;
  return new;
end $$;
drop trigger if exists cash_box_guard on public.cash_boxes;
create trigger cash_box_guard before update on public.cash_boxes for each row execute function public.guard_cash_box();

-- ---------- Transactions ----------
create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  caisse text not null references public.cash_boxes(id),
  kind text not null check (kind in ('in','out')),
  date date not null,
  ref text, code text, market text, party text,
  cat text not null,
  details text not null,
  amount numeric not null check (amount > 0),
  obs text,
  proof text,
  approvals text[] not null default '{}',
  asset boolean not null default false,
  files jsonb not null default '[]',
  source text not null default 'app' check (source in ('import','app','topup')),
  request_id text,
  voided boolean not null default false,
  void_reason text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
alter table public.cash_transactions add column if not exists edit_reason text;  -- reason for the latest edit (each edit is kept in treasury_log)
create index if not exists cash_tx_box_date on public.cash_transactions(caisse, date, seq);

create or replace function public.guard_cash_tx() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.source <> 'app' then raise exception 'Imported and top-up transactions cannot be changed'; end if;
    if old.voided then raise exception 'This transaction was cancelled and cannot be changed'; end if;
    if new.caisse <> old.caisse then raise exception 'The cash box of a transaction cannot be changed'; end if;
    new.source := old.source; new.created_at := old.created_at; new.created_by := old.created_by;
    if new.voided and coalesce(new.void_reason,'') = '' then raise exception 'Give a reason to cancel a transaction'; end if;
    if not new.voided and auth.uid() is not null and (coalesce(trim(new.edit_reason),'') = '' or new.edit_reason is not distinct from old.edit_reason) then
      raise exception 'Give a reason for this change';
    end if;
  elsif tg_op = 'INSERT' and auth.uid() is not null and new.source = 'app' then
    new.created_by := auth.uid();
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists cash_tx_guard on public.cash_transactions;
create trigger cash_tx_guard before insert or update on public.cash_transactions for each row execute function public.guard_cash_tx();

-- ---------- Fund requests (§7) ----------
create table if not exists public.fund_requests (
  id text primary key,
  caisse text not null references public.cash_boxes(id),
  type text not null check (type in ('courant','exceptionnel')),
  amount numeric not null check (amount > 0),
  reason text not null,
  details text, need date,
  files jsonb not null default '[]',
  flow text[] not null default '{daf}',
  status text not null default 'submitted' check (status in ('submitted','comptable','daf','dg','funded','rejected')),
  bank_ref text, reject_reason text, rejected_at int,
  history jsonb not null default '[]',
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function public.guard_fund_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.treasury_role(); i int; nxt text;
begin
  if tg_op = 'INSERT' then
    if public.treasury_box() is distinct from new.caisse then raise exception 'Only the manager of this cash box can request funds for it'; end if;
    new.status := 'submitted';
    new.flow := case new.type when 'exceptionnel' then array['daf','dg'] else array['daf'] end;  -- manual §7
    new.created_by := auth.uid(); new.created_at := now(); new.bank_ref := null; new.reject_reason := null;
    new.history := jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'role', r, 'action', 'submitted'));
    return new;
  end if;
  -- UPDATE: only a status step is allowed
  if old.status in ('funded','rejected') then raise exception 'This request is closed'; end if;
  if new.caisse <> old.caisse or new.type <> old.type or new.amount <> old.amount or new.flow <> old.flow or new.created_by is distinct from old.created_by
     or new.reason <> old.reason or new.details is distinct from old.details or new.files <> old.files then
    raise exception 'A submitted request cannot be edited';
  end if;
  if auth.uid() = old.created_by then raise exception 'You cannot approve or fund your own request (separation of duties)'; end if;
  i := case when old.status = 'submitted' then 0 else coalesce(array_position(old.flow, old.status), 0) end;
  nxt := case when i < array_length(old.flow, 1) then old.flow[i + 1] else 'tresorier' end;
  -- the DAF also records the bank transfer (Cedric, 20 Nov 2026: no separate Treasurer dashboard)
  if r is distinct from nxt and not (nxt = 'tresorier' and r = 'daf') then raise exception 'This step is for the %', nxt; end if;
  if new.status = 'rejected' then
    if coalesce(new.reject_reason,'') = '' then raise exception 'Give a reason for the rejection'; end if;
    new.rejected_at := i + 1;
  elsif nxt = 'tresorier' then
    if new.status <> 'funded' or coalesce(new.bank_ref,'') = '' then raise exception 'Enter the bank transfer reference to mark the request as funded'; end if;
  elsif new.status <> nxt then
    raise exception 'Invalid step';
  end if;
  new.history := old.history || jsonb_build_object('at', now(), 'by', auth.uid(), 'role', r, 'action', new.status);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fund_req_guard on public.fund_requests;
create trigger fund_req_guard before insert or update on public.fund_requests for each row execute function public.guard_fund_request();

-- when a request is funded, the top-up is added to the cash box automatically
create or replace function public.fund_request_topup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'funded' and old.status <> 'funded' then
    insert into public.cash_transactions (caisse, kind, date, ref, party, cat, details, amount, proof, approvals, source, request_id, created_by)
    values (new.caisse, 'in', current_date, new.id, 'DAF',
            case new.caisse when 'cacao' then 'Approvisionnement DAF' else 'Approvisionnement' end,
            'Approvisionnement ' || new.id || ' (' || new.bank_ref || ')', new.amount, 'recu', new.flow, 'topup', new.id, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists fund_req_topup on public.fund_requests;
create trigger fund_req_topup after update on public.fund_requests for each row execute function public.fund_request_topup();

-- ---------- Change log (kept 10 years per the manual, never editable from the app) ----------
create table if not exists public.treasury_log (
  id bigint generated always as identity primary key,
  table_name text not null, record_id text not null, action text not null,
  changes jsonb, changed_by uuid, changed_at timestamptz not null default now()
);
create or replace function public.treasury_log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.treasury_log(table_name, record_id, action, changes, changed_by) values (tg_table_name, new.id::text, 'created', to_jsonb(new), auth.uid());
  else
    select jsonb_object_agg(n.key, jsonb_build_array(to_jsonb(old)->n.key, n.value)) into d
    from jsonb_each(to_jsonb(new)) n where n.key not in ('updated_at','updated_by','history') and n.value is distinct from (to_jsonb(old)->n.key);
    if d is not null then insert into public.treasury_log(table_name, record_id, action, changes, changed_by) values (tg_table_name, new.id::text, 'updated', d, auth.uid()); end if;
  end if;
  return new;
end $$;
drop trigger if exists cash_tx_log on public.cash_transactions;
create trigger cash_tx_log after insert or update on public.cash_transactions for each row execute function public.treasury_log_change();
drop trigger if exists fund_req_log on public.fund_requests;
create trigger fund_req_log after insert or update on public.fund_requests for each row execute function public.treasury_log_change();
drop trigger if exists cash_box_log on public.cash_boxes;
create trigger cash_box_log after update on public.cash_boxes for each row execute function public.treasury_log_change();

-- ---------- Questions from Accounting to a cash box or the DAF ----------
create table if not exists public.treasury_questions (
  id bigint generated always as identity primary key,
  target text not null check (target in ('cacao','admin','daf')),
  tx_id uuid references public.cash_transactions(id),
  question text not null,
  answer text,
  asked_by uuid default auth.uid(), asked_at timestamptz not null default now(),
  answered_by uuid, answered_at timestamptz
);
create or replace function public.guard_treasury_question() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.treasury_role(); b text;
begin
  if tg_op = 'INSERT' then
    if r is distinct from 'comptable' then raise exception 'Only Accounting can ask a question'; end if;
    if coalesce(trim(new.question),'') = '' then raise exception 'Write the question'; end if;
    if new.tx_id is not null and new.target <> 'daf' then
      select caisse into b from public.cash_transactions where id = new.tx_id;
      if b is distinct from new.target then raise exception 'This transaction belongs to another cash box'; end if;
    end if;
    new.asked_by := auth.uid(); new.asked_at := now(); new.answer := null; new.answered_by := null; new.answered_at := null;
    return new;
  end if;
  if old.answer is not null then raise exception 'This question has already been answered'; end if;
  if not ((old.target = 'daf' and r = 'daf') or public.treasury_box() = old.target) then raise exception 'This question is for someone else'; end if;
  if coalesce(trim(new.answer),'') = '' then raise exception 'Write the answer'; end if;
  new.target := old.target; new.tx_id := old.tx_id; new.question := old.question; new.asked_by := old.asked_by; new.asked_at := old.asked_at;
  new.answered_by := auth.uid(); new.answered_at := now();
  return new;
end $$;
drop trigger if exists treasury_question_guard on public.treasury_questions;
create trigger treasury_question_guard before insert or update on public.treasury_questions for each row execute function public.guard_treasury_question();

-- ---------- Row level security ----------
alter table public.treasury_members enable row level security;
alter table public.cash_boxes enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.fund_requests enable row level security;
alter table public.treasury_log enable row level security;
alter table public.treasury_questions enable row level security;

drop policy if exists "tm read" on public.treasury_members;
create policy "tm read" on public.treasury_members for select to authenticated using (true);
drop policy if exists "tm daf insert" on public.treasury_members;
create policy "tm daf insert" on public.treasury_members for insert to authenticated with check (public.treasury_role() = 'daf');
drop policy if exists "tm daf update" on public.treasury_members;
create policy "tm daf update" on public.treasury_members for update to authenticated using (public.treasury_role() = 'daf') with check (public.treasury_role() = 'daf');
drop policy if exists "tm daf delete" on public.treasury_members;
create policy "tm daf delete" on public.treasury_members for delete to authenticated using (public.treasury_role() = 'daf' and user_id <> auth.uid());

drop policy if exists "boxes read" on public.cash_boxes;
create policy "boxes read" on public.cash_boxes for select to authenticated using (public.treasury_sees(id));
drop policy if exists "boxes daf update" on public.cash_boxes;
create policy "boxes daf update" on public.cash_boxes for update to authenticated using (public.treasury_role() = 'daf') with check (public.treasury_role() = 'daf');

drop policy if exists "tx read" on public.cash_transactions;
create policy "tx read" on public.cash_transactions for select to authenticated using (public.treasury_sees(caisse));
drop policy if exists "tx insert" on public.cash_transactions;
create policy "tx insert" on public.cash_transactions for insert to authenticated with check (public.treasury_box() = caisse and source = 'app');
drop policy if exists "tx update" on public.cash_transactions;
create policy "tx update" on public.cash_transactions for update to authenticated using (public.treasury_box() = caisse) with check (public.treasury_box() = caisse);

drop policy if exists "req read" on public.fund_requests;
create policy "req read" on public.fund_requests for select to authenticated using (public.treasury_sees(caisse));
drop policy if exists "req insert" on public.fund_requests;
create policy "req insert" on public.fund_requests for insert to authenticated with check (public.treasury_box() = caisse);
drop policy if exists "req update" on public.fund_requests;
create policy "req update" on public.fund_requests for update to authenticated using (public.treasury_role() in ('daf','dg','tresorier')) with check (public.treasury_role() in ('daf','dg','tresorier'));

drop policy if exists "tlog read" on public.treasury_log;
create policy "tlog read" on public.treasury_log for select to authenticated using (
  public.treasury_role() in ('daf','dg','comptable')
  or (table_name = 'cash_boxes' and record_id = public.treasury_box())
  or (table_name = 'cash_transactions' and exists (select 1 from public.cash_transactions t where t.id::text = record_id and t.caisse = public.treasury_box()))
  or (table_name = 'fund_requests' and exists (select 1 from public.fund_requests q where q.id = record_id and q.caisse = public.treasury_box())));

drop policy if exists "tq read" on public.treasury_questions;
create policy "tq read" on public.treasury_questions for select to authenticated using (public.treasury_role() in ('daf','dg','comptable') or public.treasury_box() = target);
drop policy if exists "tq ask" on public.treasury_questions;
create policy "tq ask" on public.treasury_questions for insert to authenticated with check (public.treasury_role() = 'comptable');
drop policy if exists "tq answer" on public.treasury_questions;
create policy "tq answer" on public.treasury_questions for update to authenticated
  using ((target = 'daf' and public.treasury_role() = 'daf') or public.treasury_box() = target)
  with check ((target = 'daf' and public.treasury_role() = 'daf') or public.treasury_box() = target);

revoke delete on public.cash_transactions, public.fund_requests, public.treasury_log, public.cash_boxes, public.treasury_questions from anon, authenticated;
revoke all on public.treasury_questions from anon;
grant select, insert, update on public.treasury_questions to authenticated;
revoke insert, update on public.treasury_log from anon, authenticated;

-- ---------- Supporting documents storage ----------
insert into storage.buckets (id, name, public) values ('treasury-files','treasury-files', false) on conflict (id) do nothing;
drop policy if exists "tfiles read" on storage.objects;
create policy "tfiles read" on storage.objects for select to authenticated using (bucket_id = 'treasury-files' and public.treasury_role() is not null);
drop policy if exists "tfiles write" on storage.objects;
create policy "tfiles write" on storage.objects for insert to authenticated with check (bucket_id = 'treasury-files' and public.treasury_box() is not null);

-- ---------- Import of the two Excel cash books (runs only once) ----------
do $$ begin
  if not exists (select 1 from public.cash_transactions where source = 'import') then
    insert into public.cash_transactions (caisse, kind, date, ref, market, party, cat, details, amount, obs, source) values
      ('cacao','in','2026-10-06',null,null,'DAF','Approvisionnement DAF','Approvisionnement DAF',15624000,'RAS','import'),
      ('cacao','out','2026-10-07','COC-001-20261007-001',null,'EMMANUEL BA-ATILA','Achat de cacao','Achat de cacao magasin',226950,'RAS','import'),
      ('cacao','out','2026-10-07','COC-003-20261007-002',43,'BODRIGUE AMBENEBE','Achat de cacao','Achat de cacao Minkama/ Awono',7239800,'RAS','import'),
      ('cacao','out','2026-10-07','COC-009-20261007-003',43,'BODRIGUE AMBENEBE','Carburant','Achat de carburant 1017',20000,'RAS','import'),
      ('cacao','out','2026-10-07','COC-001-20261007-004',null,'EMMANUEL BA-ATILA','Achat de cacao','Achat de cacao magasin',474350,'RAS','import'),
      ('cacao','out','2026-10-07','COC-001-20261007-005',null,'EMMANUEL BA-ATILA','Achat de cacao','Achat cacao magasin',288850,'RAS','import'),
      ('cacao','out','2026-10-07','COC-001-20261007-006',44,'EMMANUEL BA-ATILA','Achat de cacao','Achat cacao Ekoumdouma',1293200,'RAS','import'),
      ('cacao','in','2026-10-07',null,null,'DAF','Approvisionnement DAF','Approvisionnement DAF',8950000,'RAS','import'),
      ('cacao','out','2026-10-08','COC-002-20261008-001',45,'AYISSI FERDINAND','Achat de cacao','Ramassage de zone Mfou',7950000,'RAS','import'),
      ('cacao','in','2026-10-09',null,null,'DAF','Approvisionnement DAF','Approvisionnement DAF',14000000,'RAS','import'),
      ('cacao','out','2026-10-09','COC-001-20261009-001',46,'BA-ATILA EMMANUEL','Achat de cacao','Achat de cacao Messobo',13568500,'RAS','import'),
      ('cacao','out','2026-10-09','COC-001-20261009-002',null,'BA-ATILA EMMANUEL','Achat de cacao','Achat de cacao magasin',4369850,'RAS','import'),
      ('cacao','out','2026-10-09','COC-001-20261009-003',null,'BA-ATILA EMMANUEL','Achat de cacao','Achat de cacao magasin',90100,'RAS','import'),
      ('cacao','out','2026-10-09','COC-007-20261009-004',null,'MOON','Prestations MOON Ltd','Paiement camion MOON',264000,'RAS','import'),
      ('cacao','out','2026-10-09','COC-011-20261009-005',null,'ASSOMO RINEL','Frais de mission','Frais d''escorte livraison AGL',15000,'RAS','import'),
      ('cacao','out','2026-10-09',null,null,'ASSOMO RINEL','mains levées','Main levée AGL',20000,'High cocoa humidity','import'),
      ('cacao','out','2026-10-09','COC-014-20261009-006',null,'GHISLAINE FOUDA','Usinage','Frais d''usinage',94500,'RAS','import'),
      ('cacao','out','2026-10-13','COC-001-20261013-001',null,'EMMANUEL BA-ATILA','Achat de cacao','Achat de cacao magasin',1523000,'RAS','import'),
      ('cacao','out','2026-10-13','COC-009-20261013-002',null,'CEDRIC WATEGANG','Carburant','Regularisation carburation Rav 4',245000,'RAS','import'),
      ('cacao','in','2026-10-15','COC-002-20261008-001',44,'AYISSI FERDINAND','Retour en caisse','Retour en caisse',7950000,'RAS','import'),
      ('cacao','out','2026-10-15','COC-002-20261008-001',44,'AYISSI FERDINAND','Achat de cacao','Achat de cacao Mfou',5937000,'RAS','import'),
      ('cacao','out','2026-10-15','COC-002-20261008-001',44,'AYISSI FERDINAND','Carburant','Achat de carburant pickup',25000,'RAS','import'),
      ('cacao','out','2026-10-15','COC-002-20261008-001',44,'AYISSI FERDINAND','Frais de transport et ration','Frais de route',5000,'RAS','import'),
      ('cacao','out','2026-10-15','COC-002-20261008-001',44,'AYISSI FERDINAND','Frais de transport et ration','Ration',4500,'RAS','import'),
      ('cacao','out','2026-10-16',null,null,'AYISSI FERDINAND','mains levées','Main levée Ayissi Ferdinand',50000,'Excellent effort in operations this campaign','import'),
      ('cacao','out','2026-10-18',null,null,'DG','Carburant','Achat de carburant Sequoia PDG',40000,'Requested by DG SAIC','import'),
      ('cacao','out','2026-10-19','COC-005-20261019-004',null,'KOFFI ANAMA','Manutention','Regularisation manutention',7500,'RAS','import'),
      ('cacao','out','2026-10-27',null,null,'BROLLING NEIKO','Services extérieurs','Serigraphie/flyers/rollup/polo Bange Bank',123000,'Caisse Admin did not have enough funds','import'),
      ('admin','out','2026-11-02','Bon N° 0000194',null,null,'Document administratif','Achats des timbres fiscaux pour dossier impots',5000,null,'import'),
      ('admin','in','2026-11-03','Bon N°284',null,null,'Approvisionnement','Approvisionnement Caisse Admin',454150,null,'import'),
      ('admin','in','2026-11-03','Bon N°285',null,null,'Approvisionnement','Approvisionnement Caisse Admin',482600,null,'import'),
      ('admin','out','2026-11-03','Bon N° 0000195',null,null,'Salaire','Masse Salariale',454150,null,'import'),
      ('admin','out','2026-11-03','Bon N° 0000196',null,null,'Autre dépense','Ration + Logement prestataire pickup',67500,null,'import'),
      ('admin','in','2026-11-04','Bon N°286',null,null,'Approvisionnement','Approvisionnement Caisse Admin',589000,null,'import'),
      ('admin','out','2026-11-04','Bon N° 0000197',null,null,'Frais de mission','Descente d''inspection terrain(exploitation) de Mfou',60000,null,'import'),
      ('admin','out','2026-11-04','Bon N° 0000198',null,null,'Entretien magasin','Recharge prépayé',7500,null,'import'),
      ('admin','out','2026-11-04','Bon N° 0000199',null,null,'Entretien magasin','Achat de graviers pour remblayage de la surface sechage cacao',70000,null,'import'),
      ('admin','out','2026-11-04','Bon N° 0000200',null,null,'Fourniture et matériel','Achat des palettes d''eau',5000,null,'import'),
      ('admin','out','2026-11-04','Bon N° 0000201',null,null,'Entretien magasin','Assainissement du magasin',30000,null,'import'),
      ('admin','out','2026-11-04','Bon N° 0000202',null,null,'Frais de transport et ration','Frais de route pour transport graviers',7000,null,'import'),
      ('admin','in','2026-11-06',null,null,null,'Retour en caisse','Retour en Caisse',15150,null,'import'),
      ('admin','out','2026-11-06','Bon N° 0000203',null,null,'Entretien et réparation véhicule','Réparation Rav-4',589000,null,'import'),
      ('admin','out','2026-11-06','Bon N° 0000204',null,null,'Document administratif','Règlement frais bancaires',4000,null,'import'),
      ('admin','out','2026-11-06','Bon N° 0000205',null,null,'Entretien et réparation véhicule','Réparation motos',10000,null,'import'),
      ('admin','out','2026-11-06','Bon N° 0000206',null,null,'Entretien et réparation véhicule','Réparation Rav-4',15500,null,'import'),
      ('admin','out','2026-11-09','Bon N° 0000207',null,null,'Carburant','Carburation pickup Ce014LN',15000,null,'import'),
      ('admin','out','2026-11-09','Bon N° 0000208',null,null,'Frais de transport et ration','Frais de route + Frais de transport',2500,null,'import'),
      ('admin','out','2026-11-09','Bon N° 0000209',null,null,'Main levée','Main levée pour laissez-passer pour moto + frais de transport',20000,null,'import'),
      ('admin','out','2026-11-09','Bon N° 0000210',null,null,'Frais de transport et ration','Frais de transport + ration',2500,null,'import'),
      ('admin','out','2026-11-10','Bon N° 0000211',null,null,'Entretien et réparation véhicule','Vidange des motos',12000,null,'import'),
      ('admin','out','2026-11-10','Bon N° 0000212',null,null,'Frais de transport et ration','Frais de transport + ration',2500,null,'import'),
      ('admin','out','2026-11-10','Bon N° 0000213',null,null,'Entretien et réparation véhicule','Réparation pickup Ce014LN',115000,null,'import'),
      ('admin','in','2026-11-11','Bon N°287',null,null,'Approvisionnement','Approvisionnement Caisse Admin',600000,null,'import'),
      ('admin','in','2026-11-11','Bon N°288',null,null,'Approvisionnement','Approvisionnement Caisse Admin',266350,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000214',null,null,'Fourniture et matériel','Achats des palettes d''eau',5000,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000215',null,null,'Entretien magasin','Recharge prépayé',7500,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000216',null,null,'Entretien et réparation véhicule','Réparation pickup location',17000,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000217',null,null,'Carburant','Carburation pickup Ce014LN',10000,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000218',null,null,'Commission','Assistance policière canine Commissaire Elie',600000,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000219',null,null,'Fourniture et matériel','Impression roll up petite baszk,dépliant,Broderie polos',123000,null,'import'),
      ('admin','out','2026-11-11','Bon N° 0000220',null,null,'Document administratif','Règlement frais bancaires',350,null,'import'),
      ('admin','out','2026-11-12','Bon N° 0000221',null,null,'Fourniture et matériel','Achats médicaments et herbicide',50500,null,'import'),
      ('admin','out','2026-11-16','Bon N° 0000222',null,null,'Entretien et réparation véhicule','Réparation pickup Ce014LN (Segmentation du moteur)',111000,null,'import'),
      ('admin','out','2026-11-16','Bon N° 0000223',null,null,'Fourniture et matériel','Achats des palettes d''eau',5000,null,'import');
  end if;
end $$;

-- =====================================================================
-- Then give each person their treasury role (replace the emails), for example:
--   insert into public.treasury_members (user_id, role)
--   select id, 'daf' from auth.users where email = 'daf@example.com'
--   on conflict (user_id) do update set role = excluded.role;
-- After that the DAF can manage everyone's role from the DAF dashboard's Team page (/daf#team).
-- =====================================================================

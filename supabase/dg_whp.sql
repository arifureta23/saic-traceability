-- =====================================================================
-- WHP — DG WHP dashboard (/dg-whp). Same page and tables as /dg-saic, for a second office.
-- Run AFTER dg_saic.sql. Safe to run again.
--
-- Each request goes to one office, decided by the sender's entity:
--   'cacao', 'industries' → DG SAIC (exec role dg_saic)
--   'whp' (WHP head office) → DG WHP  (exec role dg_whp)
-- The DG WHP also reads SAIC's apps (read only), like the PDG.
-- =====================================================================

create or replace function public.is_dg_whp() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.exec_role() = 'dg_whp', false)
$$;
-- the office a DG runs, or null
create or replace function public.dg_office() returns text
language sql stable security definer set search_path = public as $$
  select case when public.exec_role() in ('dg_saic','dg_whp') then public.exec_role() end
$$;
create or replace function public.office_of(ent text) returns text
language sql immutable as $$ select case when ent = 'whp' then 'dg_whp' else 'dg_saic' end $$;

-- ---------- entity 'whp' on staff and requests ----------
alter table public.saic_staff drop constraint if exists saic_staff_entity_check;
alter table public.saic_staff add constraint saic_staff_entity_check check (entity in ('cacao','industries','whp'));
alter table public.dg_requests drop constraint if exists dg_requests_entity_check;
alter table public.dg_requests add constraint dg_requests_entity_check check (entity in ('cacao','industries','whp'));
alter table public.dg_requests add column if not exists office text generated always as (public.office_of(entity)) stored;

-- ---------- staff list: each DG manages their own office's staff ----------
drop policy if exists "staff read" on public.saic_staff;
create policy "staff read" on public.saic_staff for select to authenticated
  using (user_id = auth.uid() or public.is_pdg() or public.dg_office() = public.office_of(entity));
drop policy if exists "staff dg insert" on public.saic_staff;
create policy "staff dg insert" on public.saic_staff for insert to authenticated
  with check (public.dg_office() = public.office_of(entity));
drop policy if exists "staff dg update" on public.saic_staff;
create policy "staff dg update" on public.saic_staff for update to authenticated
  using (public.dg_office() = public.office_of(entity)) with check (public.dg_office() = public.office_of(entity));

-- ---------- requests: rules for both offices ----------
create or replace function public.guard_dg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := public.saic_submitter(); dgo text := public.dg_office(); dg boolean; nm text;
begin
  if auth.uid() is null then return new; end if;   -- setup from the SQL Editor
  if tg_op = 'INSERT' then
    if ent is null or dgo is not null then raise exception 'Only staff send requests to a DG'; end if;
    select coalesce(full_name, '') into nm from public.profiles where id = auth.uid();
    new.from_user := auth.uid(); new.from_name := coalesce(nm, '');
    if exists (select 1 from public.saic_staff where user_id = auth.uid() and active) then
      select entity, case when new.department = '' then department else new.department end into new.entity, new.department
      from public.saic_staff where user_id = auth.uid();
    else
      new.entity := ent;
    end if;
    new.status := 'pending'; new.example := false; new.pdg_ref := null; new.last_note := null; new.created_at := now();
    new.history := jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'role', 'staff', 'name', new.from_name, 'action', 'submitted'));
    return new;
  end if;
  if new.entity <> old.entity or new.department <> old.department or new.type <> old.type or new.title <> old.title or new.amount <> old.amount
     or new.details <> old.details or new.from_user is distinct from old.from_user or new.from_name <> old.from_name or new.example <> old.example then
    raise exception 'A submitted request cannot be edited';
  end if;
  dg := dgo is not null and dgo = old.office;
  if dg then
    if old.status <> 'pending' then raise exception 'This request is not waiting for a decision'; end if;
    if new.status not in ('approved','rejected','info','escalated') then raise exception 'Invalid decision'; end if;
    if new.status in ('rejected','info') and coalesce(trim(new.last_note),'') = '' then raise exception 'Add a reason or a question'; end if;
    if new.status = 'escalated' then
      if new.pdg_ref is null or not exists (select 1 from public.pdg_requests where id = new.pdg_ref and from_role = dgo) then
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
  new.history := old.history || jsonb_build_object('at', now(), 'by', auth.uid(), 'role', case when dg then dgo else 'staff' end,
    'action', case when dg then new.status else 'reply' end, 'note', nullif(trim(new.last_note),''), 'pdg_ref', new.pdg_ref);
  new.updated_at := now();
  return new;
end $$;

drop policy if exists "dgreq read" on public.dg_requests;
create policy "dgreq read" on public.dg_requests for select to authenticated
  using (public.dg_office() = office or public.is_pdg() or from_user = auth.uid());
drop policy if exists "dgreq insert" on public.dg_requests;
create policy "dgreq insert" on public.dg_requests for insert to authenticated
  with check (public.saic_submitter() is not null and public.dg_office() is null);
drop policy if exists "dgreq update" on public.dg_requests;
create policy "dgreq update" on public.dg_requests for update to authenticated
  using (public.dg_office() = office or from_user = auth.uid()) with check (public.dg_office() = office or from_user = auth.uid());

-- ---------- the DG WHP reads SAIC's apps (read only) ----------
drop policy if exists "dgwhp read" on public.farmers;           create policy "dgwhp read" on public.farmers           for select to authenticated using (public.is_dg_whp());
drop policy if exists "dgwhp read" on public.plots;             create policy "dgwhp read" on public.plots             for select to authenticated using (public.is_dg_whp());
drop policy if exists "dgwhp read" on public.cash_boxes;        create policy "dgwhp read" on public.cash_boxes        for select to authenticated using (public.is_dg_whp());
drop policy if exists "dgwhp read" on public.cash_transactions; create policy "dgwhp read" on public.cash_transactions for select to authenticated using (public.is_dg_whp());
drop policy if exists "dgwhp read" on public.cocoa_receptions;  create policy "dgwhp read" on public.cocoa_receptions  for select to authenticated using (public.is_dg_whp());
drop policy if exists "dgwhp read" on public.cocoa_sales;       create policy "dgwhp read" on public.cocoa_sales       for select to authenticated using (public.is_dg_whp());

-- ---------- attachments: either DG reads the files sent to them ----------
drop policy if exists "dgfiles read" on storage.objects;
create policy "dgfiles read" on storage.objects for select to authenticated
  using (bucket_id = 'dg-files' and (public.dg_office() is not null or public.is_pdg() or (storage.foldername(name))[1] = auth.uid()::text));

-- ---------- example requests for the DG WHP (marked "Example") ----------
insert into public.dg_requests (id, entity, department, from_name, type, title, amount, urgency, due, details, status, example, created_at, history) values
 ('DGW-2026-EX001','whp','Ressources humaines','Responsable RH (exemple)','recrutement','Recrutement d''un contrôleur de gestion groupe',0,'normal','2026-11-30',
  'Poste à créer au siège pour consolider les comptes des filiales. Fiche de poste et budget annuel joints.',
  'pending', true, '2026-11-17T08:15:00Z', '[{"at":"2026-11-17T08:15:00Z","role":"staff","name":"Responsable RH (exemple)","action":"submitted"}]'),
 ('DGW-2026-EX002','whp','Informatique','Responsable informatique (exemple)','achat','Renouvellement des ordinateurs portables du siège',4800000,'urgent','2026-11-24',
  '8 portables de plus de 6 ans, pannes fréquentes. Trois devis comparés.',
  'pending', true, '2026-11-16T10:00:00Z', '[{"at":"2026-11-16T10:00:00Z","role":"staff","name":"Responsable informatique (exemple)","action":"submitted"}]'),
 ('DGW-2026-EX003','whp','Juridique','Juriste (exemple)','contrat','Renouvellement du bail des bureaux de Yaoundé',0,'normal',null,
  'Le bail arrive à échéance en janvier. Le bailleur propose +8 %.',
  'info', true, '2026-11-14T11:00:00Z', '[{"at":"2026-11-14T11:00:00Z","role":"staff","name":"Juriste (exemple)","action":"submitted"},{"at":"2026-11-14T15:00:00Z","role":"dg_whp","action":"info","note":"Merci de joindre deux offres de bureaux comparables."}]')
on conflict (id) do nothing;

-- =====================================================================
-- Then give the DG WHP his role (replace the email):
--   insert into public.exec_members (user_id, role)
--   select id, 'dg_whp' from auth.users where email = 'dg.whp@example.com'
--   on conflict (user_id) do update set role = excluded.role;
-- He adds WHP head-office staff from /dg-whp → Team.
-- =====================================================================

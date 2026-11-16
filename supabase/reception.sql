-- =====================================================================
-- SAIC — Cocoa reception (/reception)
-- Run AFTER schema.sql (registry), treasury.sql and pdg.sql. Safe to run again.
-- Uses the registry roles: Traceability Lead and Warehouse Manager record receptions; read only otherwise.
-- =====================================================================

create table if not exists public.cocoa_receptions (
  id uuid primary key default gen_random_uuid(),
  no int not null,
  date date not null,
  market text, zone text not null,
  kind text not null default 'magasin' check (kind in ('magasin','ramassage','exceptionnel')),
  buyer text,
  qty numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  amount numeric generated always as (qty * price) stored,
  received numeric check (received is null or received >= 0),
  bonus numeric generated always as (case when received is null then null else greatest(received - qty, 0) end) stored,
  loss numeric generated always as (case when received is null then null else greatest(qty - received, 0) end) stored,
  bags int, humidity numeric, grade text, slip text, vehicle text, obs text,
  lines jsonb not null default '[]',      -- [{farmer: 'F0001', plot: 'P01', kg: 120}]
  files jsonb not null default '[]',
  source text not null default 'app' check (source in ('import','app')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create index if not exists cocoa_rec_date on public.cocoa_receptions(date, no);

create table if not exists public.cocoa_sales (
  id uuid primary key default gen_random_uuid(),
  date date not null, client text not null, escort text,
  qty numeric not null, bags int, price numeric, received numeric, amount numeric, status text,
  created_at timestamptz not null default now()
);

-- every farmer and plot named in a reception must exist in the registry
create or replace function public.guard_reception() returns trigger
language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  for l in select * from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb)) loop
    if not exists (select 1 from public.farmers where id = upper(l->>'farmer')) then
      raise exception 'Farmer % is not in the registry', l->>'farmer';
    end if;
    if coalesce(l->>'plot','') <> '' and not exists (select 1 from public.plots where farmer_id = upper(l->>'farmer') and pid = l->>'plot') then
      raise exception 'Plot % does not belong to farmer %', l->>'plot', l->>'farmer';
    end if;
    if coalesce((l->>'kg')::numeric, 0) <= 0 then raise exception 'Each farmer line needs a quantity in kg'; end if;
  end loop;
  if tg_op = 'UPDATE' then new.source := old.source; new.created_at := old.created_at; new.created_by := old.created_by; end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists cocoa_rec_guard on public.cocoa_receptions;
create trigger cocoa_rec_guard before insert or update on public.cocoa_receptions for each row execute function public.guard_reception();

-- change log
create table if not exists public.reception_log (
  id bigint generated always as identity primary key,
  record_id text not null, action text not null, changes jsonb, changed_by uuid, changed_at timestamptz not null default now()
);
create or replace function public.reception_log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.reception_log(record_id, action, changes, changed_by) values (new.id::text, 'created', null, auth.uid());
  else
    select jsonb_object_agg(n.key, jsonb_build_array(to_jsonb(old)->n.key, n.value)) into d
    from jsonb_each(to_jsonb(new)) n where n.key not in ('updated_at','updated_by') and n.value is distinct from (to_jsonb(old)->n.key);
    if d is not null then insert into public.reception_log(record_id, action, changes, changed_by) values (new.id::text, 'updated', d, auth.uid()); end if;
  end if;
  return new;
end $$;
drop trigger if exists cocoa_rec_log on public.cocoa_receptions;
create trigger cocoa_rec_log after insert or update on public.cocoa_receptions for each row execute function public.reception_log_change();

-- access
alter table public.cocoa_receptions enable row level security;
alter table public.cocoa_sales enable row level security;
alter table public.reception_log enable row level security;
drop policy if exists "rec read" on public.cocoa_receptions;
create policy "rec read" on public.cocoa_receptions for select to authenticated using (public.app_role() is not null or public.is_pdg());
drop policy if exists "rec insert" on public.cocoa_receptions;
create policy "rec insert" on public.cocoa_receptions for insert to authenticated with check (public.app_role() in ('lead','warehouse') and source = 'app');
drop policy if exists "rec update" on public.cocoa_receptions;
create policy "rec update" on public.cocoa_receptions for update to authenticated using (public.app_role() in ('lead','warehouse')) with check (public.app_role() in ('lead','warehouse'));
drop policy if exists "sales read" on public.cocoa_sales;
create policy "sales read" on public.cocoa_sales for select to authenticated using (public.app_role() is not null or public.is_pdg());
drop policy if exists "sales write" on public.cocoa_sales;
create policy "sales write" on public.cocoa_sales for insert to authenticated with check (public.app_role() in ('lead','warehouse'));
drop policy if exists "reclog read" on public.reception_log;
create policy "reclog read" on public.reception_log for select to authenticated using (public.app_role() is not null or public.is_pdg());
revoke delete on public.cocoa_receptions, public.cocoa_sales, public.reception_log from anon, authenticated;
revoke insert, update on public.reception_log from anon, authenticated;

-- the PDG and the registry users can read farmers for the delivery pages (registry users already can)
insert into storage.buckets (id, name, public) values ('reception-files','reception-files', false) on conflict (id) do nothing;
drop policy if exists "recfiles read" on storage.objects;
create policy "recfiles read" on storage.objects for select to authenticated using (bucket_id = 'reception-files' and (public.app_role() is not null or public.is_pdg()));
drop policy if exists "recfiles write" on storage.objects;
create policy "recfiles write" on storage.objects for insert to authenticated with check (bucket_id = 'reception-files' and public.app_role() in ('lead','warehouse'));

-- ---------- Import of the 2026/2027 inventory account (runs only once) ----------
do $$ begin
  if not exists (select 1 from public.cocoa_receptions where source = 'import') then
    insert into public.cocoa_receptions (no, date, market, zone, kind, buyer, qty, price, received, obs, source) values
      (1,'2026-07-22',null,'Obala','magasin','Achat magasin',12,2300,12,null,'import'),
      (2,'2026-07-23',null,'Obala','magasin','Achat magasin',27,2350,27,null,'import'),
      (3,'2026-07-24','002','Ntui','ramassage','Ayissi Ferdinand',2,2300,2,null,'import'),
      (4,'2026-07-27',null,'Minkama/Awono','magasin','Achat magasin',900,2500,900,null,'import'),
      (5,'2026-07-27',null,'Obala','magasin','Achat magasin',239,2400,239,null,'import'),
      (6,'2026-07-27','001','Pan Makak','ramassage','Moubi Lucien',1108,2400,1041,null,'import'),
      (7,'2026-07-28',null,'Obala','magasin','Achat magasin',101,2350,101,null,'import'),
      (8,'2026-07-28','003','Ayos','ramassage','Ambenebe Bodrigue',404,2400,404,null,'import'),
      (9,'2026-07-28',null,'Obala','magasin','Achat magasin',65,2300,65,null,'import'),
      (10,'2026-07-29',null,'Obala','magasin','Achat magasin',8,2300,8,null,'import'),
      (11,'2026-07-29',null,'Obala','magasin','Achat magasin',38,2300,38,null,'import'),
      (12,'2026-07-30',null,'Obala','magasin','Achat magasin',75,2300,75,null,'import'),
      (13,'2026-07-30',null,'Obala','magasin','Achat magasin',51,2300,51,null,'import'),
      (14,'2026-08-01',null,'Obala','magasin','Achat magasin',100,2300,100,null,'import'),
      (15,'2026-08-01','005','Ntui','ramassage','Ayissi Ferdinand',7,2300,7,null,'import'),
      (16,'2026-08-03','008','Ayos','ramassage','Ambenebe Bodrigue',1070,2400,1070,null,'import'),
      (17,'2026-08-03',null,'Obala','magasin','Achat magasin',91,2300,91,null,'import'),
      (18,'2026-08-03',null,'Obala','magasin','Achat magasin',158,2300,158,null,'import'),
      (19,'2026-08-03',null,'Obala','magasin','Achat magasin',19,2300,19,null,'import'),
      (20,'2026-08-04',null,'Ntui','ramassage','Ayissi Ferdinand',835,2400,835,null,'import'),
      (21,'2026-08-04',null,'Obala','magasin','Achat magasin',1883,2525,1883,null,'import'),
      (22,'2026-08-05',null,'Minkama/Awono','magasin','Achat magasin',833.5,2400,833.5,null,'import'),
      (23,'2026-08-05',null,'Minkama/Awono','magasin','Achat magasin',168.5,2500,168.5,null,'import'),
      (24,'2026-08-05',null,'Obala','magasin','Achat magasin',14,2300,14,null,'import'),
      (25,'2026-08-05',null,'Obala','magasin','Achat magasin',99,2425,99,null,'import'),
      (26,'2026-08-06',null,'Saa/Ndzodo','ramassage','Assomo Rinel',2000,2700,2000,null,'import'),
      (27,'2026-08-07',null,'Obala','magasin','Achat magasin',103,2450,103,null,'import'),
      (28,'2026-08-07',null,'Obala','magasin','Achat magasin',77,2450,77,null,'import'),
      (29,'2026-08-07',null,'Obala','ramassage','Ambenebe Bodrigue',794,2700,794,null,'import'),
      (30,'2026-08-07',null,'Obala','ramassage','Ambenebe Bodrigue',780,2700,780,null,'import'),
      (31,'2026-08-08',null,'Obala','magasin','Achat magasin',28,2350,28,null,'import'),
      (32,'2026-08-08',null,'Obala','magasin','Achat magasin',42,2350,42,null,'import'),
      (33,'2026-08-10',null,'Obala','magasin','Achat magasin',168,2400,168,null,'import'),
      (34,'2026-08-11',null,'Ntui','ramassage','Ayissi Ferdinand',471,2550,471,null,'import'),
      (35,'2026-08-12',null,'Obala','magasin','Achat magasin',56,2400,56,null,'import'),
      (36,'2026-08-14',null,'Obala','magasin','Achat magasin',38,2400,38,null,'import'),
      (37,'2026-08-14',null,'Saa','ramassage','Assomo Rinel',2000,2650,1993,null,'import'),
      (38,'2026-08-17',null,'Obala','magasin','Achat magasin',72,2400,72,null,'import'),
      (39,'2026-08-17',null,'Pan Makak','ramassage','Ambenebe Bodrigue',680,2550,680,null,'import'),
      (40,'2026-08-17',null,'Yaounde/Emana','ramassage','Ambenebe Bodrigue',4486,2675,4486,null,'import'),
      (41,'2026-08-18',null,'Obala','magasin','Achat magasin',103,2500,103,null,'import'),
      (42,'2026-08-22',null,'Ngomedzap','ramassage','Ambenebe Bodrigue',2691,2700,2691,null,'import'),
      (43,'2026-08-23',null,'Saa','ramassage','Assomo Rinel',3000,2700,2996,null,'import'),
      (44,'2026-08-26',null,'Obala','magasin','Achat magasin',131,2500,131,null,'import'),
      (45,'2026-08-27',null,'Saa','ramassage','Assomo Rinel',5000,2700,5009,null,'import'),
      (46,'2026-08-27',null,'Obala','magasin','Achat magasin',86,2475,86,null,'import'),
      (47,'2026-08-28',null,'Obala','magasin','Achat magasin',93,2500,93,null,'import'),
      (48,'2026-08-29',null,'Ngomedzap','ramassage','Ambenebe Bodrigue',2263,2650,2263,null,'import'),
      (49,'2026-09-01',null,'Pan Makak','ramassage','Moubi Lucien',1420,2650,1420,null,'import'),
      (50,'2026-09-01',null,'Pan Makak','magasin','Achat magasin',32,2650,32,null,'import'),
      (51,'2026-09-02',null,'Obala','magasin','Achat magasin',24,2550,24,null,'import'),
      (52,'2026-09-02',null,'Saa','ramassage','Ambenebe Bodrigue',4691,2825,4701,null,'import'),
      (53,'2026-09-02',null,'Boutourou','ramassage','Wategang Cedric',10545,3000,10574,null,'import'),
      (54,'2026-09-12',null,'Obala','magasin','Achat magasin',136,2600,136,null,'import'),
      (55,'2026-09-13',null,'Pan Makak','ramassage','Moubi Lucien',1323,2700,1323,null,'import'),
      (56,'2026-09-14',null,'Obala','magasin','Achat magasin',95,2600,95,null,'import'),
      (57,'2026-09-15',null,'Obala','magasin','Achat magasin',289,2600,289,null,'import'),
      (58,'2026-09-18',null,'Mfou','ramassage','Ayissi Ferdinand',1003,2650,1003,null,'import'),
      (59,'2026-09-18',null,'Mfou','ramassage','Ayissi Ferdinand',203,2650,203,null,'import'),
      (60,'2026-09-18',null,'Obala','magasin','Achat magasin',47,2600,47,null,'import'),
      (61,'2026-09-22',null,'Pan Makak','ramassage','Moubi Lucien/Assomo R',1203,2700,1203,null,'import'),
      (62,'2026-09-22',null,'Mfou','ramassage','Ayissi Ferdinand',562,2700,562,null,'import'),
      (63,'2026-09-22',null,'Awae Village','ramassage','Ayissi Ferdinand',672,2700,684,null,'import'),
      (64,'2026-09-24',null,'Obala','magasin','Achat magasin',30,2450,30,null,'import'),
      (65,'2026-09-24',null,'Obala','magasin','Achat magasin',14,2450,14,null,'import'),
      (66,'2026-09-26',null,'Ntui','ramassage','Ayissi Ferdinand',30,2600,30,null,'import'),
      (67,'2026-09-29',null,'Obala','magasin','Achat magasin',28,2450,28,null,'import'),
      (68,'2026-09-30',null,'Ntui','ramassage','Ayissi Ferdinand',387,2650,null,null,'import'),
      (69,'2026-10-01',null,'Obala','magasin','Achat magasin',79,2600,null,null,'import'),
      (70,'2026-10-01',null,'Ombessa','ramassage','Ayissi Ferdinand',824,2700,null,null,'import'),
      (71,'2026-10-01',null,'Obala','magasin','Achat magasin',354,2650,null,null,'import'),
      (72,'2026-10-02',null,'Monatele','ramassage','Cedric Wategang/ Ayissi Ferdinand',7113,2700,null,'Perte de 13 kg notée au compte d''achat','import'),
      (73,'2026-10-02',null,'Minkama/Awono','magasin','Achat magasin',1207,2700,null,null,'import'),
      (73,'2026-10-02',null,'Minkama/Awono','magasin','Achat magasin',793,2700,null,null,'import'),
      (74,'2026-10-02',null,'Pan Makak','ramassage','Assomo Rinel',1642,2625,null,null,'import'),
      (75,'2026-10-07',null,'Obala','magasin','Achat magasin',89,2550,null,null,'import'),
      (76,'2026-10-07',null,'Obala','magasin','Achat magasin',109,2650,null,null,'import'),
      (77,'2026-10-07',null,'Obala','magasin','Achat magasin',179,2650,null,null,'import'),
      (78,'2026-10-07',null,'Minkama/Awono','magasin','Achat magasin',2732,2650,null,null,'import'),
      (79,'2026-10-07',null,'Ekoumdouma','ramassage','Ayissi Ferdinand',488,2650,null,null,'import'),
      (80,'2026-10-09',null,'Obala','ramassage','Messobo',4934,2750,null,null,'import'),
      (81,'2026-10-09',null,'Ekoumdouma','magasin','Achat magasin',34,2650,null,null,'import'),
      (82,'2026-10-09',null,'Ekoumdouma','magasin','Achat magasin',1649,2649,null,null,'import'),
      (83,'2026-10-13',null,'Obala','magasin','Achat magasin',585,2600,null,null,'import'),
      (84,'2026-10-17',null,'Mfou','ramassage','Ayissi Ferdinand',1623,2650,null,null,'import'),
      (85,'2026-10-17',null,'Mfou','magasin','Achat magasin',618,2650,618,null,'import');
  end if;
  if not exists (select 1 from public.cocoa_sales) then
    insert into public.cocoa_sales (date, client, escort, qty, bags, price, received, amount, status) values
      ('2026-07-07','ETG','Assomo Rinel',10032,152,null,10071,63964578,'80 % payé'),
      ('2026-07-24','ETG','Assomo Rinel',15048,228,null,15107,null,'80 % payé'),
      ('2026-09-03','ETG','Assomo Rinel',25080,380,null,25133,48486400,'80% Payé'),
      ('2026-09-18','EYOUM NOCKO',null,3190,31,2900,3190,9251000,'Payé'),
      ('2026-10-02','ETG','Ayissi Ferdinand',12606,191,null,12594,0,null),
      ('2026-10-09','ETG','Assomo Rinel',12474,189,null,12434,0,null);
  end if;
end $$;

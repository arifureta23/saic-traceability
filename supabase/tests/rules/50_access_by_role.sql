-- Security: who can see and change what, for each kind of account.
-- Mirrors the security test run of 19 Nov 2026 on the live project (done there with every change cancelled).
-- Tests marked TODO are known open problems: they are reported but do not fail the run.
-- When the fix lands, remove the todo() line above them so they become hard checks.
begin;
select no_plan();

-- ---------- people and sample data (as the admin) ----------
select tests.user('lead@sec'), tests.user('warehouse@sec'), tests.user('comptable@sec'), tests.user('daf@sec'),
       tests.user('pdg@sec'), tests.user('dgsaic@sec'), tests.user('newcomer@sec');
update public.profiles set role = 'lead' where id = tests.user('lead@sec');
update public.profiles set role = 'warehouse' where id = tests.user('warehouse@sec');
insert into public.treasury_members (user_id, role) values (tests.user('comptable@sec'), 'comptable'), (tests.user('daf@sec'), 'daf')
  on conflict (user_id) do update set role = excluded.role;
insert into public.exec_members (user_id, role) values (tests.user('pdg@sec'), 'pdg'), (tests.user('dgsaic@sec'), 'dg_saic')
  on conflict do nothing;
insert into public.farmers (id, type, name, phone, id_number, village) values ('F9001', 'individual', 'Test Farmer', '+237600000000', 'CNI-TEST', 'Test village');
insert into public.plots (farmer_id, pid, lat, lon) values ('F9001', 'P01', 4.051234, 9.701234);
insert into storage.objects (bucket_id, name) values ('farmer-photos', 'F9001/photo.jpg');
create temp table counts_before as
  select t, tests.visible('public.' || t) as n
  from unnest(array['farmers','plots','change_log','cocoa_receptions','cocoa_sales','reception_log','cash_boxes',
                    'cash_transactions','fund_requests','treasury_log']) t;
grant select on counts_before to anon, authenticated;

-- ---------- 1. No account at all ----------
set local role anon;
select is(tests.visible('public.' || t), 0::bigint, 'no account: sees no rows in ' || t)
  from unnest(array['farmers','plots','change_log','cocoa_receptions','cocoa_sales','reception_log','cash_boxes','cash_transactions',
                    'fund_requests','treasury_log','treasury_members','dg_requests','pdg_requests','exec_members','saic_staff','profiles']) t;
select is(tests.visible('storage.objects'), 0::bigint, 'no account: sees no stored files');
select is(tests.changed($$update public.farmers set name = 'x'$$), 0::bigint, 'no account: cannot edit farmers');
select is(tests.changed($$insert into public.farmers (type, name) values ('individual', 'x')$$), 0::bigint, 'no account: cannot add farmers');
reset role;

-- ---------- 2. A brand-new sign-up (nobody gave them a role) ----------
select tests.login('newcomer@sec');
select is(tests.visible('public.' || t), 0::bigint, 'new sign-up: sees no rows in ' || t)
  from unnest(array['cash_boxes','cash_transactions','fund_requests','treasury_log','dg_requests','pdg_requests','saic_staff']) t;
select is(tests.changed($$update public.profiles set role = 'lead' where id = auth.uid()$$), 0::bigint, 'new sign-up: cannot make itself Traceability lead');
select is(tests.changed($$insert into public.treasury_members (user_id, role) values (auth.uid(), 'daf')$$), 0::bigint, 'new sign-up: cannot join the treasury');
select is(tests.changed($$insert into public.exec_members (user_id, role) values (auth.uid(), 'pdg')$$), 0::bigint, 'new sign-up: cannot make itself PDG');
select is(tests.changed($$update public.farmers set name = 'x'$$), 0::bigint, 'new sign-up: cannot edit farmers');
select is(tests.changed($$insert into storage.objects (bucket_id, name) values ('farmer-photos', 'x/evil.jpg')$$), 0::bigint, 'new sign-up: cannot upload farmer photos');

select todo('Known problem H1 (security test 19 Nov 2026): new accounts get the viewer role, which can read the registry', 8);
select is(tests.visible('public.' || t), 0::bigint, 'new sign-up: sees no rows in ' || t)
  from unnest(array['farmers','plots','change_log','cocoa_receptions','cocoa_sales','reception_log']) t;
select is(tests.visible($$storage.objects where bucket_id = 'farmer-photos'$$), 0::bigint, 'new sign-up: sees no farmer photos');
select is(public.app_role(), null, 'new sign-up: has no registry role until the lead gives one');
select todo('Known problem L1: every signed-in account can list all account names and roles', 1);
select cmp_ok(tests.visible('public.profiles'), '<=', 1::bigint, 'new sign-up: sees only its own profile');
select tests.logout();

-- ---------- 3. Nothing is ever deleted, whoever asks ----------
select tests.login(who) from unnest(array['lead@sec']) who;
select is(tests.changed('delete from public.' || t), 0::bigint, 'lead: cannot delete from ' || t)
  from unnest(array['farmers','plots','change_log','cocoa_receptions','cocoa_sales','reception_log','cash_transactions','fund_requests','treasury_log']) t;
select tests.logout();
select tests.login('warehouse@sec');
select is(tests.changed('delete from public.' || t), 0::bigint, 'warehouse: cannot delete from ' || t)
  from unnest(array['farmers','plots','change_log','cocoa_receptions','reception_log']) t;
select is(tests.changed($$update public.change_log set action = action$$), 0::bigint, 'warehouse: cannot rewrite the registry history');
select tests.logout();
select tests.login('comptable@sec');
select is(tests.changed('delete from public.' || t), 0::bigint, 'accountant: cannot delete from ' || t)
  from unnest(array['cash_transactions','fund_requests','treasury_log']) t;
select tests.logout();
select is(tests.visible('public.' || c.t), c.n, 'still the same number of rows in ' || c.t) from counts_before c;

-- ---------- 4. Nobody promotes themselves ----------
select tests.login('warehouse@sec');
select is(tests.changed($$update public.profiles set role = 'lead' where id = auth.uid()$$), 0::bigint, 'warehouse: cannot make itself lead');
select is(tests.changed($$insert into public.exec_members (user_id, role) values (auth.uid(), 'pdg')$$), 0::bigint, 'warehouse: cannot make itself PDG');
select tests.logout();
select tests.login('comptable@sec');
select is(tests.changed($$update public.treasury_members set role = 'daf' where user_id = auth.uid()$$), 0::bigint, 'accountant: cannot make itself DAF');
select todo('Known problem H1: every account also gets the viewer role, so treasury staff can read the registry', 1);
select is(tests.visible('public.farmers'), 0::bigint, 'accountant (no registry role): sees no farmers');
select tests.logout();
select tests.login('dgsaic@sec');
select is(tests.changed($$insert into public.exec_members (user_id, role) values (auth.uid(), 'pdg')$$), 0::bigint, 'DG SAIC: cannot make itself PDG');
select tests.logout();
select is((select role from public.profiles where id = tests.user('warehouse@sec')), 'warehouse', 'warehouse role unchanged');
select is((select role from public.treasury_members where user_id = tests.user('comptable@sec')), 'comptable', 'accountant role unchanged');
select is((select count(*) from public.exec_members where role = 'pdg'), 1::bigint, 'still exactly one PDG');

-- ---------- 5. Cash box ceilings ----------
select tests.login('comptable@sec');
select is(tests.changed($$update public.cash_boxes set ceiling = 999999999$$), 0::bigint, 'accountant: cannot change a cash box ceiling');
select tests.logout();
create temp table tlog_before as select count(*) n from public.treasury_log;
select tests.login('daf@sec');
select cmp_ok(tests.changed($$update public.cash_boxes set ceiling = ceiling + 1 where id = 'cacao'$$), '=', 1::bigint, 'DAF: can change a ceiling (by design)');
select tests.logout();
select todo('Known problem M2: a ceiling change is not written to the treasury history', 1);
select cmp_ok((select count(*) from public.treasury_log), '>', (select n from tlog_before), 'a ceiling change is written to the treasury history');

select * from finish();
rollback;

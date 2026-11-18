-- dg_whp.sql replaces guard_dg_request() and the dg_requests policies that dg_saic.sql created.
-- These tests check the office-aware version is the one in force, and what happens if dg_saic.sql is run again later
-- (its header says "Safe to run again").
begin;
select no_plan();

select ok(pg_get_functiondef('public.guard_dg_request'::regproc) like '%dg_office()%', 'the guard in force is the office-aware one from dg_whp.sql');
select ok((select qual from pg_policies where tablename = 'dg_requests' and policyname = 'dgreq read') like '%dg_office()%',
  'the read rule in force is the office-aware one from dg_whp.sql');

insert into public.exec_members (user_id, role) values (tests.user('dgsaic@test'), 'dg_saic'), (tests.user('dgwhp@test'), 'dg_whp');
insert into public.saic_staff (user_id, entity) values (tests.user('whp@test'), 'whp');
select tests.login('whp@test');
insert into public.dg_requests (id, entity, type, title, details) values ('T-W1','whp','achat','PC','x');
insert into public.dg_requests (id, entity, type, title, details) values ('T-W2','whp','achat','Imprimante','x');
select tests.logout();

-- someone runs dg_saic.sql again (for example to repair the DG SAIC page) without running dg_whp.sql after it
\i supabase/dg_saic.sql

select tests.login('dgsaic@test');
select todo('dg_saic.sql puts back its SAIC-only rules: the DG SAIC then sees WHP requests', 1);
select is((select count(*)::int from public.dg_requests where id = 'T-W1'), 0, 'after re-running dg_saic.sql, the DG SAIC still cannot see WHP requests');
update public.dg_requests set status = 'approved' where id = 'T-W2';
select tests.logout();
select todo('dg_saic.sql puts back its SAIC-only guard: the DG SAIC can then decide on WHP requests', 1);
select is((select status from public.dg_requests where id = 'T-W2'), 'pending', 'after re-running dg_saic.sql, the DG SAIC still cannot decide on WHP requests');

select tests.login('dgwhp@test');
select todo('dg_saic.sql puts back its SAIC-only rules: the DG WHP loses his inbox', 1);
select is((select count(*)::int from public.dg_requests where id = 'T-W1'), 1, 'after re-running dg_saic.sql, the DG WHP still sees WHP requests');
select tests.logout();

-- running dg_whp.sql again repairs it
\i supabase/dg_whp.sql
select tests.login('dgsaic@test');
select is((select count(*)::int from public.dg_requests where office = 'dg_whp'), 0, 'running dg_whp.sql again restores office scoping');
select tests.logout();

select * from finish();
rollback;

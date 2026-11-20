-- Requests to the DGs: each request goes to one office (DG SAIC or DG WHP), and only that DG sees and decides on it.
begin;
select no_plan();

insert into public.exec_members (user_id, role) values
  (tests.user('dgsaic@test'), 'dg_saic'), (tests.user('dgwhp@test'), 'dg_whp'), (tests.user('pdg@test'), 'pdg');
insert into public.saic_staff (user_id, entity, department) values
  (tests.user('cacao@test'), 'cacao', 'Magasin'), (tests.user('industries@test'), 'industries', 'Production'),
  (tests.user('whp@test'), 'whp', 'RH');
select tests.user('lead@test');
update public.profiles set role = 'lead' where id = tests.user('lead@test');
select tests.user('outsider@test');

-- ---------- sending ----------
select tests.login('whp@test');
select lives_ok($$insert into public.dg_requests (id, entity, type, title, details, status) values ('T-W1','cacao','achat','PC','x','approved')$$,
  'WHP staff send a request (forging entity and status)');
select tests.logout();
select is((select array[entity, office, status] from public.dg_requests where id = 'T-W1'), array['whp','dg_whp','pending'],
  'the entity comes from the staff list, so the request goes to the DG WHP, pending');

select tests.login('cacao@test');
insert into public.dg_requests (id, entity, type, title, details) values ('T-C1','whp','depense','Bascule','x');
insert into public.dg_requests (id, entity, type, title, details) values ('T-C2','whp','depense','Carburant','x');
select tests.logout();
select is((select office from public.dg_requests where id = 'T-C1'), 'dg_saic', 'SAIC Cacao staff → DG SAIC, even if they pick another entity');

select tests.login('industries@test');
insert into public.dg_requests (id, entity, type, title, details) values ('T-I1','cacao','achat','Pièces','x');
select tests.logout();
select is((select array[entity, office] from public.dg_requests where id = 'T-I1'), array['industries','dg_saic'], 'SAIC Industries staff → DG SAIC');

select tests.login('lead@test');
insert into public.dg_requests (id, entity, type, title, details) values ('T-L1','whp','autre','Registre','x');
select tests.logout();
select is((select office from public.dg_requests where id = 'T-L1'), 'dg_saic', 'registry users not on the staff list send to the DG SAIC (as SAIC Cacao)');

select tests.login('outsider@test');
select throws_ok($$insert into public.dg_requests (id, entity, type, title, details) values ('T-O1','whp','autre','x','x')$$,
  'Only staff send requests to a DG', 'someone with no role cannot send a request');
select tests.logout();
select tests.login('dgwhp@test');
select throws_ok($$insert into public.dg_requests (id, entity, type, title, details) values ('T-D1','whp','autre','x','x')$$,
  'Only staff send requests to a DG', 'a DG cannot send a request to a DG (no self-approval)');
select tests.logout();

-- ---------- who sees what ----------
select tests.login('dgsaic@test');
select set_eq($$select id from public.dg_requests where id like 'T-%'$$, array['T-C1','T-C2','T-I1','T-L1'], 'the DG SAIC sees only SAIC requests');
select is((select count(*)::int from public.dg_requests where office = 'dg_whp'), 0, 'the DG SAIC sees no WHP request (examples included)');
select tests.logout();
select tests.login('dgwhp@test');
select set_eq($$select id from public.dg_requests where id like 'T-%'$$, array['T-W1'], 'the DG WHP sees only WHP requests');
select is((select count(*)::int from public.dg_requests where office = 'dg_saic'), 0, 'the DG WHP sees no SAIC request (examples included)');
select tests.logout();
select tests.login('pdg@test');
select set_eq($$select id from public.dg_requests where id like 'T-%'$$, array['T-W1','T-C1','T-C2','T-I1','T-L1'], 'the PDG sees every request');
select tests.logout();
select tests.login('cacao@test');
select set_eq($$select id from public.dg_requests where id like 'T-%'$$, array['T-C1','T-C2'], 'staff see only their own requests');
select tests.logout();

-- ---------- who decides ----------
select tests.login('dgsaic@test');
update public.dg_requests set status = 'approved' where id = 'T-W1';
select tests.logout();
select is((select status from public.dg_requests where id = 'T-W1'), 'pending', 'the DG SAIC cannot decide on a WHP request');
select tests.login('dgwhp@test');
update public.dg_requests set status = 'approved' where id = 'T-C1';
select tests.logout();
select is((select status from public.dg_requests where id = 'T-C1'), 'pending', 'the DG WHP cannot decide on a SAIC request');
select tests.login('pdg@test');
update public.dg_requests set status = 'approved' where id = 'T-C1';
select tests.logout();
select is((select status from public.dg_requests where id = 'T-C1'), 'pending', 'the PDG cannot decide inside the DG inbox');
select tests.login('cacao@test');
select throws_ok($$update public.dg_requests set status = 'approved' where id = 'T-C1'$$,
  'You can only answer a question from the DG', 'staff cannot approve their own request');
select throws_ok($$update public.dg_requests set amount = 999 where id = 'T-C1'$$,
  'A submitted request cannot be edited', 'staff cannot edit a sent request');
select tests.logout();
select tests.login('industries@test');
update public.dg_requests set status = 'approved' where id = 'T-C1';
select tests.logout();
select is((select status from public.dg_requests where id = 'T-C1'), 'pending', 'other staff cannot touch a colleague''s request');

select tests.login('dgwhp@test');
select throws_ok($$update public.dg_requests set status = 'rejected' where id = 'T-W1'$$, 'Add a reason or a question', 'a rejection needs a reason');
select lives_ok($$update public.dg_requests set status = 'approved' where id = 'T-W1'$$, 'the DG WHP approves a WHP request');
select throws_ok($$update public.dg_requests set status = 'rejected', last_note = 'x' where id = 'T-W1'$$,
  'This request is not waiting for a decision', 'a decided request is final');
select tests.logout();
select is((select history->-1->>'role' from public.dg_requests where id = 'T-W1'), 'dg_whp', 'the history records which DG decided');

-- question and answer
select tests.login('dgsaic@test');
select throws_ok($$update public.dg_requests set status = 'info' where id = 'T-C1'$$, 'Add a reason or a question', 'a question needs text');
select lives_ok($$update public.dg_requests set status = 'info', last_note = 'Devis ?' where id = 'T-C1'$$, 'the DG SAIC asks a question');
select tests.logout();
select tests.login('cacao@test');
select throws_ok($$update public.dg_requests set status = 'pending', last_note = ' ' where id = 'T-C1'$$, 'Write your answer', 'an answer needs text');
select lives_ok($$update public.dg_requests set status = 'pending', last_note = 'Joint' where id = 'T-C1'$$, 'the sender answers');
select tests.logout();
select is((select status from public.dg_requests where id = 'T-C1'), 'pending', 'the answered request is back with the DG');

-- KNOWN GAP: if the sender leaves the answer out, the DG's question is kept in last_note and counts as the answer
select tests.login('dgsaic@test');
update public.dg_requests set status = 'info', last_note = 'Programme de mission ?' where id = 'T-L1';
select tests.logout();
select tests.login('lead@test');
select todo('the guard checks last_note, which still holds the DG''s question when the sender sends no answer', 1);
select throws_ok($$update public.dg_requests set status = 'pending' where id = 'T-L1'$$, 'Write your answer',
  'an answer with no text is refused');
select tests.logout();

-- forwarding to the PDG: only with the DG's own PDG request
select tests.login('dgsaic@test');
insert into public.pdg_requests (id, ent, type, title, details) values ('T-P-SAIC','SAIC','autre','Bascule','x');
select tests.logout();
select tests.login('dgwhp@test');
insert into public.pdg_requests (id, ent, type, title, details) values ('T-P-WHP','WHP','autre','PC','x');
select tests.logout();
select tests.login('dgsaic@test');
select throws_ok($$update public.dg_requests set status = 'escalated' where id = 'T-C2'$$, 'Forward the request to the PDG first', 'forwarding needs a PDG request');
select throws_ok($$update public.dg_requests set status = 'escalated', pdg_ref = 'T-P-WHP' where id = 'T-C2'$$,
  'Forward the request to the PDG first', 'the DG SAIC cannot forward using the DG WHP''s PDG request');
select lives_ok($$update public.dg_requests set status = 'escalated', pdg_ref = 'T-P-SAIC' where id = 'T-C2'$$, 'the DG SAIC forwards to the PDG');
select tests.logout();

-- staff lists: each DG manages their own office
select tests.login('dgsaic@test');
select throws_ok($$insert into public.saic_staff (user_id, entity) values (tests.user('new1@test'), 'whp')$$, '42501', null,
  'the DG SAIC cannot add WHP staff');
select lives_ok($$insert into public.saic_staff (user_id, entity) values (tests.user('new2@test'), 'industries')$$, 'the DG SAIC adds SAIC staff');
select tests.logout();
select tests.login('dgwhp@test');
select throws_ok($$insert into public.saic_staff (user_id, entity) values (tests.user('new3@test'), 'cacao')$$, '42501', null,
  'the DG WHP cannot add SAIC staff');
select is((select count(*)::int from public.saic_staff where entity <> 'whp'), 0, 'the DG WHP does not see SAIC staff');
select throws_ok($$delete from public.dg_requests where id = 'T-W1'$$, '42501', null, 'requests cannot be deleted');
select tests.logout();

select * from finish();
rollback;

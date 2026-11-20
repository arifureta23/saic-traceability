-- Requests to the PDG: only the PDG decides, senders cannot approve their own, each sender sees their own.
begin;
select no_plan();
insert into public.exec_members (user_id, role) values
  (tests.user('pdg@test'), 'pdg'), (tests.user('dgsaic@test'), 'dg_saic'), (tests.user('dgwhp@test'), 'dg_whp'), (tests.user('dafwhp@test'), 'daf_whp');

select tests.login('pdg@test');
select throws_ok($$insert into public.pdg_requests (id, ent, type, title, details) values ('T-X','WHP','autre','x','x')$$,
  'Only the DG WHP, the DAF WHP and the DG SAIC submit requests to the PDG', 'the PDG cannot send a request to himself');
select tests.logout();

select tests.login('dgsaic@test');
select lives_ok($$insert into public.pdg_requests (id, from_role, ent, type, title, details, status) values ('T-P1','dg_whp','SAIC','autre','x','x','approved')$$,
  'the DG SAIC sends a request (forging sender and status)');
select is((select array[from_role, status] from public.pdg_requests where id = 'T-P1'), array['dg_saic','pending'], 'sender and status are set by the database');
select throws_ok($$update public.pdg_requests set status = 'approved' where id = 'T-P1'$$,
  'You can only answer a question from the PDG', 'the sender cannot approve their own request');
select tests.logout();

select tests.login('dgwhp@test');
select is((select count(*)::int from public.pdg_requests where id = 'T-P1'), 0, 'another sender does not see it');
update public.pdg_requests set status = 'approved' where id = 'T-P1';
select tests.logout();
select is((select status from public.pdg_requests where id = 'T-P1'), 'pending', 'another sender cannot decide on it');

select tests.login('pdg@test');
select throws_ok($$update public.pdg_requests set status = 'rejected' where id = 'T-P1'$$, 'Add a reason or a question', 'a rejection needs a reason');
select throws_ok($$update public.pdg_requests set status = 'approved', amount = 1 where id = 'T-P1'$$, 'A submitted request cannot be edited', 'the PDG cannot change the amount');
select lives_ok($$update public.pdg_requests set status = 'approved' where id = 'T-P1'$$, 'the PDG approves');
select throws_ok($$update public.pdg_requests set status = 'rejected', last_note = 'x' where id = 'T-P1'$$, 'This request is not waiting for a decision', 'a decision is final');
select tests.logout();

-- KNOWN GAP: as for the DG requests, an empty answer passes because last_note still holds the PDG's question
select tests.login('dafwhp@test');
insert into public.pdg_requests (id, ent, type, title, details) values ('T-P2','WHP','budget','Budget','x');
select tests.logout();
select tests.login('pdg@test');
update public.pdg_requests set status = 'info', last_note = 'Détail par poste ?' where id = 'T-P2';
select tests.logout();
select tests.login('dafwhp@test');
select todo('the guard checks last_note, which still holds the PDG''s question when the sender sends no answer', 1);
select throws_ok($$update public.pdg_requests set status = 'pending' where id = 'T-P2'$$, 'Write your answer', 'an answer with no text is refused');
select tests.logout();

select * from finish();
rollback;

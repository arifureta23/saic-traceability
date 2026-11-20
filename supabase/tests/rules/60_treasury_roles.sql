-- Treasury split by role (Nov 2026): DAF, Comptable, Caisse Achat Cacao, Caisse Administrative.
-- Each cash box manager sees and changes only their own box; Accounting reads both and asks questions;
-- the DAF approves, changes ceilings and answers. Every edit keeps its reason in treasury_log.
begin;
select no_plan();

-- ---------- people (as the admin) ----------
select tests.user('daf@roles'), tests.user('compta@roles'), tests.user('cacao@roles'), tests.user('admin@roles'), tests.user('nobody@roles'), tests.user('pdg@roles');
insert into public.treasury_members (user_id, role) values
  (tests.user('daf@roles'), 'daf'), (tests.user('compta@roles'), 'comptable'),
  (tests.user('cacao@roles'), 'caisse_cacao'), (tests.user('admin@roles'), 'caisse_admin')
  on conflict (user_id) do update set role = excluded.role;
insert into public.exec_members (user_id, role) values (tests.user('pdg@roles'), 'pdg') on conflict do nothing;
create temp table ids (k text primary key, v text);
grant all on ids to authenticated;
insert into ids values ('nobody', tests.user('nobody@roles')::text);
select is((select count(*) from public.cash_transactions where caisse = 'admin' and source = 'import') > 0, true, 'setup: admin cash book is imported');

-- ---------- Caisse Achat Cacao ----------
select tests.login('cacao@roles');
select is(tests.visible($$public.cash_transactions where caisse = 'admin'$$), 0::bigint, 'cacao box: sees no admin transactions');
select cmp_ok(tests.visible($$public.cash_transactions where caisse = 'cacao'$$), '>', 0::bigint, 'cacao box: sees its own transactions');
select is(tests.visible($$public.cash_boxes$$), 1::bigint, 'cacao box: sees only its own cash box');
select is(tests.changed($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount) values ('cacao','out','2026-11-20','Carburant','Test carburant',10000)$$), 1::bigint, 'cacao box: records an expense in its own box');
select is(tests.changed($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount) values ('admin','out','2026-11-20','Carburant','x',10000)$$), 0::bigint, 'cacao box: cannot record in the admin box');
insert into ids select 'cacao_tx', id::text from public.cash_transactions where details = 'Test carburant';
select is(tests.changed($$update public.cash_transactions set amount = 12000 where details = 'Test carburant'$$), 0::bigint, 'cacao box: an edit without a reason is refused');
select is(tests.changed($$update public.cash_transactions set amount = 12000, edit_reason = 'Péage oublié' where details = 'Test carburant'$$), 1::bigint, 'cacao box: edits its expense with a reason');
select is(tests.changed($$update public.cash_transactions set amount = 13000 where details = 'Test carburant'$$), 0::bigint, 'cacao box: a second edit needs a new reason');
select is(tests.changed($$update public.cash_transactions set details = 'x', edit_reason = 'y' where source = 'import' and caisse = 'cacao'$$), 0::bigint, 'cacao box: imported lines still cannot be changed');
select is(tests.changed($$update public.cash_transactions set voided = true, void_reason = 'Doublon' where details = 'Test carburant'$$), 1::bigint, 'cacao box: cancels its expense with a reason');
select is(tests.changed($$insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-CACAO','cacao','courant',500000,'r_weekly')$$), 1::bigint, 'cacao box: requests funds for its own box');
select is(tests.changed($$insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-X','admin','courant',500000,'r_weekly')$$), 0::bigint, 'cacao box: cannot request funds for the admin box');
select is(tests.changed($$update public.fund_requests set status = 'daf' where id = 'T-CACAO'$$), 0::bigint, 'cacao box: cannot approve its own request');
select is(tests.changed($$update public.cash_boxes set ceiling = 1 where id = 'cacao'$$), 0::bigint, 'cacao box: cannot change its ceiling');
select cmp_ok(tests.visible($$public.treasury_log where table_name = 'cash_transactions'$$), '>', 0::bigint, 'cacao box: sees the history of its own entries');
select is(tests.visible($$public.treasury_log l where table_name = 'cash_transactions' and not exists (select 1 from public.cash_transactions t where t.id::text = l.record_id and t.caisse = 'cacao')$$), 0::bigint, 'cacao box: sees no history from the admin box');
select is(tests.changed($$insert into public.treasury_questions (target, question) values ('cacao','?')$$), 0::bigint, 'cacao box: cannot ask questions');
select is(tests.changed($$insert into public.treasury_members (user_id, role) values (auth.uid(), 'daf') on conflict (user_id) do update set role = 'daf'$$), 0::bigint, 'cacao box: cannot make itself DAF');
select tests.logout();

-- ---------- Caisse Administrative ----------
select tests.login('admin@roles');
select is(tests.visible($$public.cash_transactions where caisse = 'cacao'$$), 0::bigint, 'admin box: sees no cocoa transactions');
select is(tests.visible($$public.fund_requests where caisse = 'cacao'$$), 0::bigint, 'admin box: sees no cocoa fund requests');
select is(tests.changed($$update public.cash_transactions set amount = 1, edit_reason = 'x' where caisse = 'cacao'$$), 0::bigint, 'admin box: cannot edit cocoa entries');
select is(tests.changed($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount) values ('admin','out','2026-11-20','Fourniture et matériel','Test papier',5000)$$), 1::bigint, 'admin box: records an expense in its own box');
select is(tests.changed($$insert into storage.objects (bucket_id, name) values ('treasury-files', '2026-11/x.pdf')$$), 1::bigint, 'admin box: attaches supporting documents');
select tests.logout();

-- ---------- Comptable: reads both, asks questions, changes nothing ----------
select tests.login('compta@roles');
select cmp_ok(tests.visible($$public.cash_transactions where caisse = 'cacao'$$), '>', 0::bigint, 'comptable: sees cocoa transactions');
select cmp_ok(tests.visible($$public.cash_transactions where caisse = 'admin'$$), '>', 0::bigint, 'comptable: sees admin transactions');
select is(tests.visible($$public.fund_requests where id = 'T-CACAO'$$), 1::bigint, 'comptable: sees fund requests');
select is(tests.changed($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount) values ('cacao','out','2026-11-20','Carburant','x',1)$$), 0::bigint, 'comptable: can no longer record transactions');
select is(tests.changed($$update public.cash_transactions set amount = 1, edit_reason = 'x' where details = 'Test papier'$$), 0::bigint, 'comptable: cannot edit transactions');
select is(tests.changed($$insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-C','cacao','courant',1,'r_weekly')$$), 0::bigint, 'comptable: can no longer request funds');
select is(tests.changed($$insert into storage.objects (bucket_id, name) values ('treasury-files', '2026-11/y.pdf')$$), 0::bigint, 'comptable: cannot upload files');
select is(tests.changed(format($$insert into public.treasury_questions (target, tx_id, question) values ('cacao', %L, 'Le reçu est-il joint ?')$$, (select v from ids where k = 'cacao_tx'))), 1::bigint, 'comptable: asks the cocoa box about one of its entries');
select is(tests.changed($$insert into public.treasury_questions (target, question) values ('daf', 'La demande T-CACAO est-elle validée ?')$$), 1::bigint, 'comptable: asks the DAF');
select is(tests.changed($$insert into public.treasury_questions (target, question) values ('admin', 'Bon 0000218 ?')$$), 1::bigint, 'comptable: asks the admin box');
select is(tests.changed(format($$insert into public.treasury_questions (target, tx_id, question) values ('admin', %L, 'x')$$, (select v from ids where k = 'cacao_tx'))), 0::bigint, 'comptable: a question about a cocoa entry cannot go to the admin box');
select is(tests.changed($$update public.treasury_questions set answer = 'moi' where target = 'daf'$$), 0::bigint, 'comptable: cannot answer its own questions');
select is(tests.changed($$update public.fund_requests set status = 'daf' where id = 'T-CACAO'$$), 0::bigint, 'comptable: cannot approve requests');
select tests.logout();

-- ---------- questions reach only their addressee ----------
select tests.login('cacao@roles');
select is(tests.visible($$public.treasury_questions$$), 1::bigint, 'cacao box: sees only the question sent to it');
select is(tests.changed($$update public.treasury_questions set answer = 'Oui, joint.' where target = 'cacao'$$), 1::bigint, 'cacao box: answers its question');
select is(tests.changed($$update public.treasury_questions set answer = 'x' where target = 'cacao'$$), 0::bigint, 'cacao box: an answer cannot be rewritten');
select is(tests.changed($$update public.treasury_questions set question = 'changed', answer = null where target = 'cacao'$$), 0::bigint, 'cacao box: cannot change the question');
select tests.logout();
select tests.login('admin@roles');
select is(tests.changed($$update public.treasury_questions set answer = 'x' where target in ('cacao','daf')$$), 0::bigint, 'admin box: cannot answer questions for others');
select tests.logout();

-- ---------- DAF ----------
select tests.login('daf@roles');
select is(tests.visible($$public.cash_boxes$$), 2::bigint, 'DAF: sees both cash boxes');
select is(tests.visible($$public.treasury_questions$$), 3::bigint, 'DAF: sees every question');
select is(tests.changed($$update public.treasury_questions set answer = 'Oui.' where target = 'daf'$$), 1::bigint, 'DAF: answers its question');
select is(tests.changed($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount) values ('cacao','out','2026-11-20','Carburant','x',1)$$), 0::bigint, 'DAF: does not record transactions');
select is(tests.changed($$update public.fund_requests set status = 'daf' where id = 'T-CACAO'$$), 1::bigint, 'DAF: approves the cocoa box request');
select is(tests.changed($$update public.fund_requests set status = 'funded' where id = 'T-CACAO'$$), 0::bigint, 'DAF: marking funded needs the bank reference');
select is(tests.changed($$insert into storage.objects (bucket_id, name) values ('treasury-files', '2026-11/virement.pdf')$$), 1::bigint, 'DAF: uploads the transfer slip');
select is(tests.changed($$update public.fund_requests set status = 'funded', bank_ref = 'AFB-123', transfer_files = '[{"path":"2026-11/virement.pdf","name":"virement.pdf"}]' where id = 'T-CACAO'$$), 1::bigint, 'DAF: records the bank transfer with its slip');
select is(tests.changed($$update public.cash_boxes set ceiling = 25000000 where id = 'cacao'$$), 0::bigint, 'DAF: a ceiling change without a reason is refused');
select is(tests.changed($$update public.cash_boxes set ceiling = 25000000, change_reason = 'Pic de campagne' where id = 'cacao'$$), 1::bigint, 'DAF: changes a ceiling with a reason');
select is(tests.changed($$update public.treasury_members set role = 'caisse_admin' where user_id = (select v::uuid from ids where k = 'nobody')$$), 0::bigint, 'DAF: (no row yet for a newcomer)');
select is(tests.changed($$insert into public.treasury_members (user_id, role) values ((select v::uuid from ids where k = 'nobody'), 'caisse_admin')$$), 1::bigint, 'DAF: gives a newcomer the admin box role');
select is(tests.changed($$delete from public.treasury_members where user_id = (select v::uuid from ids where k = 'nobody')$$), 1::bigint, 'DAF: removes treasury access');
select is(tests.changed($$delete from public.treasury_members where user_id = auth.uid()$$), 0::bigint, 'DAF: cannot remove its own access');
select tests.logout();
select is((select files->0->>'name' from public.cash_transactions where request_id = 'T-CACAO'), 'virement.pdf', 'funding: the top-up line carries the transfer slip');
select is((select (changes->'ceiling'->>1)::numeric from public.treasury_log where table_name = 'cash_boxes' and record_id = 'cacao' order by id desc limit 1), 25000000::numeric, 'history: the ceiling change is logged');
select is((select changes->'edit_reason'->>1 from public.treasury_log where table_name = 'cash_transactions' and record_id = (select v from ids where k = 'cacao_tx') and action = 'updated' and changes ? 'amount'), 'Péage oublié', 'history: the edit keeps old amount, new amount and reason');

-- ---------- nobody without a role; other dashboards keep their access ----------
select tests.login('nobody@roles');
select is(tests.visible('public.' || t), 0::bigint, 'no treasury role: sees nothing in ' || t)
  from unnest(array['cash_boxes','cash_transactions','fund_requests','treasury_log','treasury_questions']) t;
select tests.logout();
select tests.login('pdg@roles');
select is(tests.visible($$public.cash_boxes$$), 2::bigint, 'PDG dashboard: still reads both cash boxes');
select cmp_ok(tests.visible($$public.cash_transactions$$), '>', 0::bigint, 'PDG dashboard: still reads transactions');
select tests.logout();

select * from finish();
rollback;

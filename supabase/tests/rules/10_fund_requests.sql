-- Treasury fund requests: separation of duties, DAF → DG → Treasurer order, top-up on funding.
begin;
select no_plan();

-- people (as the admin)
insert into public.treasury_members (user_id, role) values
  (tests.user('comptable@test'), 'comptable'), (tests.user('comptable2@test'), 'comptable'), (tests.user('comptable3@test'), 'comptable'),
  (tests.user('daf@test'), 'daf'), (tests.user('dg@test'), 'dg'), (tests.user('tresorier@test'), 'tresorier'), (tests.user('viewer@test'), 'viewer');
create temp table box_before as
  select caisse, sum(case kind when 'in' then amount else -amount end) as net from public.cash_transactions where not voided group by caisse;
grant all on box_before to authenticated;

-- ---------- submitting ----------
select tests.login('comptable@test');
select lives_ok($$insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-R1','cacao','courant',1000000,'Achats')$$,
  'Accounting submits a regular request');
select lives_ok($$insert into public.fund_requests (id, caisse, type, amount, reason, status, flow, bank_ref)
                  values ('T-R2','admin','exceptionnel',200000,'Urgence','funded','{}','FAKE')$$,
  'Accounting submits an exceptional request (forged status, flow and bank reference)');
select is((select array[status, coalesce(bank_ref,'-')] from public.fund_requests where id = 'T-R2'), array['submitted','-'],
  'a new request always starts as submitted, without a bank reference');
select is((select flow from public.fund_requests where id = 'T-R1'), array['daf'], 'regular request: DAF only (manual §7)');
select is((select flow from public.fund_requests where id = 'T-R2'), array['daf','dg'], 'exceptional request: DAF then DG (manual §7)');
select tests.logout();

select tests.login('daf@test');
select throws_ok($$insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-X','cacao','courant',1,'x')$$,
  'Only Accounting can submit a fund request', 'the DAF cannot submit a request');
select tests.logout();
select tests.login('viewer@test');
select throws_ok($$insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-X','cacao','courant',1,'x')$$,
  'Only Accounting can submit a fund request', 'a viewer cannot submit a request');
select tests.logout();

-- ---------- regular request: DAF, then Treasurer ----------
select tests.login('tresorier@test');
select throws_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-1' where id = 'T-R1'$$,
  'This step is for the daf', 'the Treasurer cannot fund before the DAF approves');
select tests.logout();
select tests.login('dg@test');
select throws_ok($$update public.fund_requests set status = 'daf' where id = 'T-R1'$$,
  'This step is for the daf', 'the DG cannot take the DAF step');
select tests.logout();

select tests.login('comptable2@test');
update public.fund_requests set status = 'daf' where id = 'T-R1';
select tests.logout();
select is((select status from public.fund_requests where id = 'T-R1'), 'submitted', 'Accounting cannot approve (no row changed)');

select tests.login('daf@test');
select throws_ok($$update public.fund_requests set status = 'daf', amount = 5000000 where id = 'T-R1'$$,
  'A submitted request cannot be edited', 'the amount cannot change once submitted');
select lives_ok($$update public.fund_requests set status = 'daf' where id = 'T-R1'$$, 'the DAF approves');
select throws_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-1' where id = 'T-R1'$$,
  'This step is for the tresorier', 'the DAF cannot also fund');
select tests.logout();

select tests.login('tresorier@test');
select throws_ok($$update public.fund_requests set status = 'funded' where id = 'T-R1'$$,
  'Enter the bank transfer reference to mark the request as funded', 'funding needs the bank transfer reference');
select throws_ok($$update public.fund_requests set status = 'dg', bank_ref = 'VIR-1' where id = 'T-R1'$$,
  'Enter the bank transfer reference to mark the request as funded', 'the Treasurer step can only fund (or reject)');
select is((select count(*)::int from public.cash_transactions where request_id = 'T-R1'), 0, 'no top-up before funding');
select lives_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-1' where id = 'T-R1'$$, 'the Treasurer funds');
select tests.logout();

-- ---------- funded request tops up the cash box ----------
select results_eq($$select caisse, kind, amount, source, request_id from public.cash_transactions where request_id = 'T-R1'$$,
  $$values ('cacao'::text, 'in'::text, 1000000::numeric, 'topup'::text, 'T-R1'::text)$$,
  'funding adds exactly one top-up of the requested amount to the cocoa cash box');
select is((select sum(case kind when 'in' then amount else -amount end) from public.cash_transactions where caisse = 'cacao' and not voided)
          - (select net from box_before where caisse = 'cacao'), 1000000::numeric, 'cocoa cash box balance goes up by the request amount');
select is((select jsonb_agg(h->>'action') from public.fund_requests, jsonb_array_elements(history) h where id = 'T-R1'),
  '["submitted","daf","funded"]'::jsonb, 'history records every step in order');

select tests.login('daf@test');
select throws_ok($$update public.fund_requests set status = 'rejected', reject_reason = 'x' where id = 'T-R1'$$,
  'This request is closed', 'a funded request is closed');
select tests.logout();
select tests.login('comptable@test');
select throws_ok($$update public.cash_transactions set amount = 1 where request_id = 'T-R1'$$,
  'Imported and top-up transactions cannot be changed', 'the top-up line cannot be changed');
select tests.logout();

-- ---------- exceptional request: DAF, then DG, then Treasurer ----------
select tests.login('daf@test');
select lives_ok($$update public.fund_requests set status = 'daf' where id = 'T-R2'$$, 'DAF approves the exceptional request');
select throws_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-2' where id = 'T-R2'$$,
  'This step is for the dg', 'the DAF cannot skip the DG');
select tests.logout();
select tests.login('tresorier@test');
select throws_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-2' where id = 'T-R2'$$,
  'This step is for the dg', 'the Treasurer cannot fund before the DG');
select tests.logout();
select tests.login('dg@test');
select lives_ok($$update public.fund_requests set status = 'dg' where id = 'T-R2'$$, 'the DG approves');
select tests.logout();
select tests.login('tresorier@test');
select lives_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-2' where id = 'T-R2'$$, 'the Treasurer funds');
select tests.logout();
select is((select sum(amount) from public.cash_transactions where request_id = 'T-R2' and caisse = 'admin' and source = 'topup'),
  200000::numeric, 'the admin cash box gets the exceptional top-up');

-- ---------- rejection ----------
select tests.login('comptable@test');
insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-R3','cacao','exceptionnel',50000,'x');
select tests.logout();
select tests.login('daf@test');
update public.fund_requests set status = 'daf' where id = 'T-R3';
select tests.logout();
select tests.login('dg@test');
select throws_ok($$update public.fund_requests set status = 'rejected' where id = 'T-R3'$$,
  'Give a reason for the rejection', 'a rejection needs a reason');
select lives_ok($$update public.fund_requests set status = 'rejected', reject_reason = 'Hors budget' where id = 'T-R3'$$, 'the DG rejects with a reason');
select tests.logout();
select is((select rejected_at from public.fund_requests where id = 'T-R3'), 2, 'the rejection records the step (2 = DG)');
select is((select count(*)::int from public.cash_transactions where request_id = 'T-R3'), 0, 'a rejected request adds nothing to the cash box');

-- ---------- separation of duties: nobody acts on their own request ----------
select tests.login('comptable2@test');
insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-R4','cacao','courant',10000,'x');
select tests.logout();
update public.treasury_members set role = 'daf' where user_id = tests.user('comptable2@test');   -- the requester becomes DAF
select tests.login('comptable2@test');
select throws_ok($$update public.fund_requests set status = 'daf' where id = 'T-R4'$$,
  'You cannot approve or fund your own request (separation of duties)', 'the requester cannot approve their own request as DAF');
select tests.logout();

select tests.login('comptable3@test');
insert into public.fund_requests (id, caisse, type, amount, reason) values ('T-R5','cacao','courant',10000,'x');
select tests.logout();
select tests.login('daf@test');
update public.fund_requests set status = 'daf' where id = 'T-R5';
select tests.logout();
update public.treasury_members set role = 'tresorier' where user_id = tests.user('comptable3@test');  -- the requester becomes Treasurer
select tests.login('comptable3@test');
select throws_ok($$update public.fund_requests set status = 'funded', bank_ref = 'VIR-5' where id = 'T-R5'$$,
  'You cannot approve or fund your own request (separation of duties)', 'the requester cannot fund their own request as Treasurer');
select tests.logout();

select tests.login('daf@test');
select throws_ok($$delete from public.fund_requests where id = 'T-R4'$$, '42501', null, 'requests cannot be deleted');
select tests.logout();

select * from finish();
rollback;

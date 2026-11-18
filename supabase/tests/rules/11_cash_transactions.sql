-- Treasury cash book: imported lines are frozen, nothing is deleted, cancellations need a reason.
begin;
select no_plan();

insert into public.treasury_members (user_id, role) values
  (tests.user('comptable@test'), 'comptable'), (tests.user('daf@test'), 'daf');
create temp table imp as select id from public.cash_transactions where source = 'import' order by seq limit 1;
grant select on imp to authenticated;

select is((select count(*)::int from public.cash_transactions where source = 'import'), 64, 'the 64 Excel cash book lines are imported once, even though treasury.sql ran twice');

select tests.login('comptable@test');
select throws_ok($$update public.cash_transactions set amount = amount + 1 where id = (select id from imp)$$,
  'Imported and top-up transactions cannot be changed', 'an imported line cannot be edited');
select throws_ok($$update public.cash_transactions set voided = true, void_reason = 'erreur' where id = (select id from imp)$$,
  'Imported and top-up transactions cannot be changed', 'an imported line cannot be cancelled');
select throws_ok($$update public.cash_transactions set source = 'app' where id = (select id from imp)$$,
  'Imported and top-up transactions cannot be changed', 'an imported line cannot be relabelled as an app line');
select throws_ok($$delete from public.cash_transactions where id = (select id from imp)$$, '42501', null, 'an imported line cannot be deleted');
select throws_ok($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount, source) values ('cacao','in',current_date,'x','x',1,'import')$$,
  '42501', null, 'the app cannot add lines marked as imported');
select throws_ok($$insert into public.cash_transactions (caisse, kind, date, cat, details, amount, source) values ('cacao','in',current_date,'x','x',1,'topup')$$,
  '42501', null, 'the app cannot add lines marked as top-ups');

-- lines entered in the app
insert into public.cash_transactions (caisse, kind, date, cat, details, amount) values ('cacao','out',current_date,'Carburant','Test',5000);
create temp table app_tx as select id from public.cash_transactions where details = 'Test' and source = 'app';
select lives_ok($$update public.cash_transactions set amount = 6000 where id = (select id from app_tx)$$, 'an app line can be corrected');
select throws_ok($$update public.cash_transactions set caisse = 'admin' where id = (select id from app_tx)$$,
  'The cash box of a transaction cannot be changed', 'an app line cannot move to another cash box');
select throws_ok($$update public.cash_transactions set voided = true where id = (select id from app_tx)$$,
  'Give a reason to cancel a transaction', 'cancelling needs a reason');
select lives_ok($$update public.cash_transactions set voided = true, void_reason = 'Doublon' where id = (select id from app_tx)$$, 'cancel with a reason');
select throws_ok($$update public.cash_transactions set voided = false where id = (select id from app_tx)$$,
  'This transaction was cancelled and cannot be changed', 'a cancelled line is final');
select throws_ok($$delete from public.cash_transactions where id = (select id from app_tx)$$, '42501', null, 'an app line cannot be deleted');
select throws_ok($$insert into public.treasury_log (table_name, record_id, action) values ('x','x','x')$$, '42501', null, 'nobody writes the log by hand');
select tests.logout();

select ok((select count(*) from public.treasury_log where record_id = (select id::text from app_tx)) >= 3, 'every change of the line is in the log');

select tests.login('daf@test');
update public.cash_transactions set amount = 1 where id = (select id from app_tx);
select tests.logout();
select is((select amount from public.cash_transactions where id = (select id from app_tx)), 6000::numeric, 'only Accounting edits the cash book (DAF changes nothing)');

select * from finish();
rollback;

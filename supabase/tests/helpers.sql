-- Test helpers (loaded after the app's SQL files, test databases only).
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- creates a login and returns its id
create or replace function tests.user(p_email text) returns uuid language plpgsql security definer as $$
declare u uuid;
begin
  select id into u from auth.users where email = p_email;
  if u is null then
    insert into auth.users (email, raw_user_meta_data) values (p_email, jsonb_build_object('full_name', split_part(p_email, '@', 1)))
    returning id into u;
  end if;
  return u;
end $$;

-- act as a signed-in user for the rest of the transaction (call "reset role" to become the admin again)
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), true);
  set local role authenticated;
end $$;

create or replace function tests.logout() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

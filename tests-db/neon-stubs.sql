-- Minimaler Nachbau der Neon-Umgebung für Datenbank-Tests mit einem normalen Postgres
-- (Rollen, neon_auth."user", auth.uid()). Bei Neon gibt es das alles schon.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then create role anonymous nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists extensions;   -- Erweiterungen nicht im Schema public
create extension if not exists pgcrypto schema extensions;
create schema if not exists auth;
create schema if not exists neon_auth;
grant usage on schema auth to anonymous, authenticated;

create table if not exists neon_auth."user" (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text
);

-- Test: die "angemeldete" Person kommt aus einer Session-Variable
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anonymous, authenticated;


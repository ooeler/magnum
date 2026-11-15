-- Magnum – Datenbank einrichten.
-- Spielt der Release-Workflow ein (Neon Auth und Data API müssen aktiv sein). Mehrfaches Ausführen ist unproblematisch.
-- Grundsatz: Mitglieder sehen alles im Club und ändern nur ihre eigenen Einträge.
-- Ohne Login sieht man nichts. Abstimmungen, Einladungen und Admin-Rechte laufen nur über Funktionen.

-- Angemeldete Person: aus dem geprüften Token der laufenden Anfrage, das die Data API pro Transaktion setzt.
-- Ohne Anfrage (Function, Release, SQL Editor) ist das Ergebnis null.
create or replace function public.uid() returns uuid
language sql stable set search_path = public as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
revoke execute on function public.uid() from public, anonymous;
grant execute on function public.uid() to authenticated;

-- ───────────── Einstellungen & Wartung ─────────────
create table if not exists public.settings (
  id           int primary key default 1 check (id = 1),
  goal_title   text not null default '30 Zusagen bis zum Chlaus-Magnum',
  goal_target  int  not null default 30,
  magnum_price numeric(6,2) not null default 45
);
alter table public.settings enable row level security;
insert into public.settings (id) values (1) on conflict do nothing;
-- Das Club-Ziel bleibt, der Apéro für alle fällt weg
alter table public.settings alter column goal_title set default '30 Zusagen bis zum Chlaus-Magnum';
update public.settings set goal_title = regexp_replace(goal_title, '\s*=\s*Ap[eé]ro für alle\s*$', '', 'i') where goal_title ~* 'Ap[eé]ro für alle';

-- Wartungsseite während eines Updates (schaltet der Release-Workflow)
create table if not exists public.app_status (
  id          text primary key default 'main',
  maintenance boolean not null default false,
  since       timestamptz
);
alter table public.app_status enable row level security;
insert into public.app_status (id) values ('main') on conflict do nothing;
drop policy if exists "Status lesen" on public.app_status;
create policy "Status lesen" on public.app_status for select to anonymous, authenticated using (true);

-- ───────────── Mitglieder ─────────────
create table if not exists public.profiles (
  id                  uuid primary key references neon_auth."user"(id) on delete cascade,
  display_name        text not null default '' check (length(display_name) <= 40),
  nickname            text check (length(nickname) <= 40),
  role_title          text not null default 'Mitglied' check (length(role_title) <= 40),
  since_year          int,
  fav_wine            text check (length(fav_wine) <= 60),
  specialty           text check (length(specialty) <= 80),
  device              text not null default 'iphone' check (device in ('iphone', 'android')),
  device_set_by_admin boolean not null default false,
  is_admin            boolean not null default false,
  invited_by          uuid references public.profiles(id) on delete set null,
  last_seen           timestamptz,
  created_at          timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = public.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = public.uid()), false)
$$;

-- Jede Stimme zählt gleich viel. Das Gerät zählt nur fürs Duell des Monats.
drop function if exists public.vote_weight(uuid);

-- Heutiger Tag im Club. Die Fristen unten gelten nur für Anfragen aus der App (public.uid() gesetzt):
-- Wiederherstellung, Release und SQL Editor laufen ohne Login und sind nicht betroffen.
create or replace function public.heute() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Zurich')::date
$$;

-- Der Club hat keine Obergrenze mehr
drop trigger if exists club_size_check on public.profiles;
drop function if exists public.check_club_size();
alter table public.settings drop column if exists max_members;

-- ───────────── Einladungen (Link statt Mail, siehe functions/index.ts) ─────────────
create table if not exists public.invites (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique,
  created_by  uuid references neon_auth."user"(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references neon_auth."user"(id) on delete set null,
  email       text,                           -- Reservation beim Einlösen, siehe gate_new_user
  name        text,
  device      text,
  als_admin   boolean not null default false  -- nur der allererste Link (scripts/erster-link.mjs)
);
alter table public.invites enable row level security;
revoke all on table public.invites from anonymous, authenticated;

-- Neue Konten entstehen nur über einen Einladungslink: Die Function reserviert die Adresse, erst dann
-- nimmt die Datenbank das Konto an. Eine freie Registrierung über den Auth-Dienst scheitert hier.
create or replace function public.gate_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.invites where email = lower(new.email) and used_by is null and used_at > now() - interval '5 minutes') then
    raise exception 'Konto nur mit Einladung';
  end if;
  return new;
end $$;
drop trigger if exists user_gate on neon_auth."user";
create trigger user_gate before insert on neon_auth."user"
  for each row execute function public.gate_new_user();

-- Name und Gerät stehen in der Reservation
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare i public.invites;
begin
  select * into i from public.invites where email = lower(new.email) and used_by is null order by used_at desc limit 1;
  if not found then return new; end if;
  insert into public.profiles (id, display_name, device, since_year, is_admin, invited_by)
  values (new.id, left(coalesce(nullif(trim(i.name), ''), split_part(new.email, '@', 1)), 40),
          case when i.device = 'android' then 'android' else 'iphone' end,
          extract(year from now())::int, i.als_admin,
          (select p.id from public.profiles p where p.id = i.created_by))
  on conflict do nothing;
  update public.invites set used_by = new.id where id = i.id;
  return new;
end $$;
drop trigger if exists on_auth_user_created on neon_auth."user";
create trigger on_auth_user_created after insert on neon_auth."user"
  for each row execute function public.handle_new_user();

-- Beim App-Start: eigenes Profil + letzter Besuch (für "willkommen zurück"), Besuch speichern
create or replace function public.me() returns json
language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  select * into r from public.profiles where id = public.uid();
  if not found then return null; end if;
  update public.profiles set last_seen = now() where id = public.uid();
  return json_build_object('id', r.id, 'is_admin', r.is_admin, 'prev_seen', r.last_seen);
end $$;

-- ───────────── Admin: Gerätetyp und Funktion anpassen (mit Protokoll) ─────────────
create table if not exists public.admin_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.profiles(id) on delete set null,
  member_id  uuid references public.profiles(id) on delete cascade,
  action     text not null,
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;

create or replace function public.admin_set_device(p_member uuid, p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'Nur der Administrator darf den Gerätetyp ändern'; end if;
  if p_device not in ('iphone', 'android') then raise exception 'Unbekannter Gerätetyp'; end if;
  select device into v_old from public.profiles where id = p_member;
  if v_old is null then raise exception 'Mitglied nicht gefunden'; end if;
  if v_old = p_device then return; end if;
  update public.profiles set device = p_device, device_set_by_admin = true where id = p_member;
  insert into public.admin_log (admin_id, member_id, action)
  values (public.uid(), p_member, 'Gerätetyp ' || v_old || ' → ' || p_device);
end $$;

-- Administrator-Rolle vergeben und entziehen. Neue Konten sind Mitglieder, einer muss Administrator bleiben.
create or replace function public.admin_set_admin(p_member uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Administrator vergibt diese Rolle'; end if;
  if not p_admin and not exists (select 1 from public.profiles where is_admin and id <> p_member) then
    raise exception 'Es braucht mindestens einen Administrator';
  end if;
  update public.profiles set is_admin = p_admin where id = p_member;
  if not found then raise exception 'Mitglied nicht gefunden'; end if;
  insert into public.admin_log (admin_id, member_id, action)
  values (public.uid(), p_member, case when p_admin then 'Rolle → Administrator' else 'Rolle → Mitglied' end);
end $$;

create or replace function public.admin_set_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Administrator darf Funktionen vergeben'; end if;
  update public.profiles set role_title = left(trim(p_role), 40) where id = p_member;
  insert into public.admin_log (admin_id, member_id, action) values (public.uid(), p_member, 'Funktion → ' || left(trim(p_role), 40));
end $$;

-- ───────────── Restaurants ─────────────
create table if not exists public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  place      text check (length(place) <= 80),
  lat        double precision,
  lng        double precision,
  created_by uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.restaurants enable row level security;

create table if not exists public.restaurant_visits (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  visited_on    date not null default current_date,
  people        int  not null default 1 check (people between 1 and 100),
  total_chf     numeric(10,2) not null default 0 check (total_chf >= 0),
  receipt_path  text,
  created_by    uuid default public.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.restaurant_visits enable row level security;

create table if not exists public.restaurant_ratings (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  member_id     uuid not null default public.uid() references public.profiles(id) on delete cascade,
  preis         int not null check (preis between 1 and 5),
  gesellig      int not null check (gesellig between 1 and 5),
  willkommen    int not null check (willkommen between 1 and 5),
  updated_at    timestamptz not null default now(),
  primary key (restaurant_id, member_id)
);
alter table public.restaurant_ratings enable row level security;

-- ───────────── Anlässe, An-/Abmeldungen, Magnums, Gasttrinker ─────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(title) between 1 and 80),
  starts_at     timestamptz not null,
  location      text check (length(location) <= 120),
  organizer_id  uuid references public.profiles(id) on delete set null,
  created_by    uuid default public.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.events enable row level security;
alter table public.events add column if not exists ortschaft text check (length(ortschaft) <= 80);

-- Keine erfundenen Anlässe in der Vergangenheit, der Organisator kommt nur über claim_organizer.
-- Vergangenes trägt der Admin nach.
create or replace function public.check_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' and new.organizer_id is not null then raise exception 'Der Organisator trägt sich selbst ein'; end if;
  if (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at)
     and (new.starts_at at time zone 'Europe/Zurich')::date < public.heute() then
    raise exception 'Ein Anlass kann nicht in der Vergangenheit liegen';
  end if;
  return new;
end $$;
drop trigger if exists event_check on public.events;
create trigger event_check before insert or update on public.events
  for each row execute function public.check_event();

create table if not exists public.rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  member_id  uuid not null default public.uid() references public.profiles(id) on delete cascade,
  status     text not null check (status in ('in', 'out', 'virtual')),
  redeemed   boolean not null default false,   -- gespendete Magnum aus der Kasse geöffnet
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
alter table public.rsvps enable row level security;

-- An- und abmelden bis und mit Anlasstag. Danach gilt die Anwesenheit (Punkte, Streak, Kasse).
-- Der Organisator ist immer dabei: Abmelden geht erst, wenn er den Abend abgegeben hat.
create or replace function public.check_rsvp() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tag date; v_org uuid;
begin
  if public.uid() is not null and not public.is_admin() then
    if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'Der Anlass lässt sich nicht ändern'; end if;
    select (starts_at at time zone 'Europe/Zurich')::date, organizer_id into v_tag, v_org from public.events
     where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
    if v_tag < public.heute() then raise exception 'Der Anlass ist vorbei, die Anmeldung ist geschlossen'; end if;
    if (tg_op = 'DELETE' and old.member_id = v_org) or (tg_op <> 'DELETE' and new.member_id = v_org and new.status <> 'in') then
      raise exception 'Der Organisator ist immer dabei. Gib den Abend zuerst ab.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists rsvp_check on public.rsvps;
create trigger rsvp_check before insert or update or delete on public.rsvps
  for each row execute function public.check_rsvp();
-- Bestehende Anlässe nachziehen: Wer organisiert (hat), war dabei
insert into public.rsvps (event_id, member_id, status)
select id, organizer_id, 'in' from public.events where organizer_id is not null
on conflict (event_id, member_id) do update set status = 'in', updated_at = now() where public.rsvps.status <> 'in';

-- Die Ämtli pro Anlass gibt es nicht mehr, es braucht nur den Organisator
drop table if exists public.event_aemtli;

-- ───────────── Magnum-Serie: immer am letzten Freitag im Monat, die nächsten drei stehen im Kalender ─────────────
create or replace function public.letzter_freitag(p_monat date) returns date
language sql immutable set search_path = public as $$
  select l - ((extract(dow from l)::int + 2) % 7)
    from (select (date_trunc('month', p_monat) + interval '1 month - 1 day')::date l) x
$$;
create or replace function public.magnum_titel(p_tag date) returns text
language sql immutable set search_path = public as $$
  select (array['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'])[extract(month from p_tag)::int] || '-Magnum'
$$;
-- Welche Monate schon angelegt wurden. So kommt ein gelöschter oder verschobener Abend nicht zurück.
create table if not exists public.magnum_serie (
  monat date primary key
);
alter table public.magnum_serie enable row level security;
create or replace function public.magnum_termine() returns int
language plpgsql security definer set search_path = public as $$
declare v_monat date := date_trunc('month', public.heute())::date; v_tag date; v_neu int := 0; v_gefunden int := 0;
begin
  if public.uid() is not null and not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  while v_gefunden < 3 loop
    v_tag := public.letzter_freitag(v_monat);
    if v_tag >= public.heute() then
      v_gefunden := v_gefunden + 1;
      insert into public.magnum_serie (monat) values (v_monat) on conflict do nothing;
      if found and not exists (select 1 from public.events where (starts_at at time zone 'Europe/Zurich')::date = v_tag) then
        insert into public.events (title, starts_at, created_by)
        values (public.magnum_titel(v_tag), (v_tag + time '19:00') at time zone 'Europe/Zurich', null);
        v_neu := v_neu + 1;
      end if;
    end if;
    v_monat := (v_monat + interval '1 month')::date;
  end loop;
  return v_neu;
end $$;

-- Anwesenheit eines vergangenen Anlasses nachtragen, nur der Admin. Ohne Status wird der Eintrag entfernt.
create or replace function public.admin_set_rsvp(p_event uuid, p_member uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Administrator trägt Anwesenheit nach'; end if;
  if p_status is null then delete from public.rsvps where event_id = p_event and member_id = p_member;
  else
    insert into public.rsvps (event_id, member_id, status) values (p_event, p_member, p_status)
    on conflict (event_id, member_id) do update set status = excluded.status, updated_at = now();
  end if;
  insert into public.admin_log (admin_id, member_id, action)
  values (public.uid(), p_member, 'Anwesenheit ' || coalesce(p_status, 'entfernt') || ' · ' || (select title from public.events where id = p_event));
end $$;

-- "Ich organisiere den Abend": Einen künftigen Abend kann jedes Mitglied jederzeit übernehmen, auch von jemand anderem
-- p_bisher: wen die App als Organisator gezeigt hat. Hat inzwischen jemand anderes übernommen,
-- wird niemand still verdrängt.
drop function if exists public.claim_organizer(uuid);
create or replace function public.claim_organizer(p_event uuid, p_bisher uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  select organizer_id into v_org from public.events where id = p_event for update;
  if v_org is distinct from p_bisher and v_org is distinct from public.uid() then
    raise exception 'Inzwischen organisiert jemand anderes den Abend';
  end if;
  update public.events set organizer_id = public.uid()
   where id = p_event and organizer_id is distinct from public.uid()
     and (starts_at at time zone 'Europe/Zurich')::date >= public.heute();
  if not found then raise exception 'Der Anlass lässt sich nicht übernehmen'; end if;
  insert into public.rsvps (event_id, member_id, status) values (p_event, public.uid(), 'in')
  on conflict (event_id, member_id) do update set status = 'in', updated_at = now();
end $$;

create table if not exists public.magnums (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  wine       text not null check (length(wine) between 1 and 80),
  brought_by uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.magnums enable row level security;

create table if not exists public.magnum_guests (
  id         uuid primary key default gen_random_uuid(),
  magnum_id  uuid not null references public.magnums(id) on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  added_by   uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.magnum_guests enable row level security;

-- Magnum-Kasse: Admin öffnet alle gespendeten Magnums
create or replace function public.open_magnum_kasse() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Nur der Administrator öffnet die Kasse'; end if;
  update public.rsvps set redeemed = true where status = 'virtual' and not redeemed;
  get diagnostics n = row_count;
  return n;
end $$;

-- Beiz und Quittung gehören zum Termin
alter table public.restaurant_visits add column if not exists event_id uuid references public.events(id) on delete set null;
-- Von der Quittung: Wein in Dezilitern und Mineral in Stück. Der Wein zählt zu gleichen Teilen für alle Anwesenden.
alter table public.restaurant_visits add column if not exists wein_dl numeric(6,1) not null default 0 check (wein_dl >= 0);
alter table public.restaurant_visits add column if not exists mineral int not null default 0 check (mineral >= 0);

-- Organisator setzen oder entfernen: Admin, wer den Anlass erfasst hat oder ihn organisiert. Vergangenes nur der Admin.
create or replace function public.set_organizer(p_event uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event;
  if not found then raise exception 'Anlass nicht gefunden'; end if;
  if not (public.is_admin() or e.created_by = public.uid() or e.organizer_id = public.uid()) then
    raise exception 'Das dürfen nur Organisator und Administrator';
  end if;
  update public.events set organizer_id = p_member where id = p_event;
  if p_member is not null then
    insert into public.rsvps (event_id, member_id, status) values (p_event, p_member, 'in')
    on conflict (event_id, member_id) do update set status = 'in', updated_at = now();
  end if;
end $$;

-- ───────────── Heimweg / Fahrservice ─────────────
create table if not exists public.rides (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  driver_id  uuid not null default public.uid() references public.profiles(id) on delete cascade,
  direction  text not null default '' check (length(direction) <= 60),
  seats      int  not null default 3 check (seats between 1 and 8),
  created_at timestamptz not null default now(),
  unique (event_id, driver_id)
);
alter table public.rides enable row level security;

create table if not exists public.ride_passengers (
  ride_id        uuid not null references public.rides(id) on delete cascade,
  passenger_id   uuid not null default public.uid() references public.profiles(id) on delete cascade,
  stars_safe     int check (stars_safe between 1 and 5),
  stars_punctual int check (stars_punctual between 1 and 5),
  stars_mood     int check (stars_mood between 1 and 5),
  points_given   int check (points_given in (10, 20, 30, 50)),
  rated_at       timestamptz,
  primary key (ride_id, passenger_id)
);
alter table public.ride_passengers enable row level security;

-- Niemand fährt bei sich selbst mit, volle Autos nehmen niemanden mehr.
-- Einsteigen bis und mit Anlasstag, bewerten erst, wenn der Anlass begonnen hat.
create or replace function public.check_ride_passenger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_driver uuid; v_seats int; v_start timestamptz;
begin
  if public.uid() is null then return new; end if;
  select r.driver_id, r.seats, e.starts_at into v_driver, v_seats, v_start
    from public.rides r join public.events e on e.id = r.event_id where r.id = new.ride_id;
  if v_driver = new.passenger_id then raise exception 'Du kannst nicht bei dir selbst mitfahren'; end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.ride_passengers where ride_id = new.ride_id) >= v_seats then raise exception 'Das Auto ist voll'; end if;
    if (v_start at time zone 'Europe/Zurich')::date < public.heute() then raise exception 'Der Anlass ist vorbei'; end if;
    if num_nonnulls(new.stars_safe, new.stars_punctual, new.stars_mood, new.points_given, new.rated_at) > 0 then
      raise exception 'Bewerten geht erst nach dem Anlass';
    end if;
  elsif v_start > now() then
    raise exception 'Bewerten geht erst nach dem Anlass';
  end if;
  return new;
end $$;
drop trigger if exists ride_passenger_check on public.ride_passengers;
create trigger ride_passenger_check before insert or update on public.ride_passengers
  for each row execute function public.check_ride_passenger();

-- ───────────── Reisen ─────────────
create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(title) between 1 and 60),
  starts_on  date not null,
  ends_on    date,
  program    text check (length(program) <= 300),
  seats      int  not null default 12 check (seats between 1 and 50),
  color      text not null default '#6E2433' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  ok_id      uuid references public.profiles(id) on delete set null,
  kassier_id uuid references public.profiles(id) on delete set null,
  sacceri_id uuid references public.profiles(id) on delete set null,  -- nur per Abstimmung
  created_by uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.trips enable row level security;

-- Keine Reisen in der Vergangenheit erfinden. Fremde Reisen: nur OK und Kassier, den Rest ändert
-- wer sie erfasst hat. Vergangenes trägt der Admin nach.
create or replace function public.check_trip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.uid() is null or public.is_admin() then return new; end if;
  if (tg_op = 'INSERT' or new.starts_on is distinct from old.starts_on) and new.starts_on < public.heute() then
    raise exception 'Eine Reise kann nicht in der Vergangenheit liegen';
  end if;
  if tg_op = 'UPDATE' and old.created_by is distinct from public.uid()
     and (new.title, new.starts_on, new.ends_on, new.program, new.seats, new.color)
         is distinct from (old.title, old.starts_on, old.ends_on, old.program, old.seats, old.color) then
    raise exception 'Nur wer die Reise erfasst hat, kann sie ändern';
  end if;
  return new;
end $$;
drop trigger if exists trip_check on public.trips;
create trigger trip_check before insert or update on public.trips
  for each row execute function public.check_trip();

create table if not exists public.trip_participants (
  trip_id   uuid not null references public.trips(id) on delete cascade,
  member_id uuid not null default public.uid() references public.profiles(id) on delete cascade,
  primary key (trip_id, member_id)
);
alter table public.trip_participants enable row level security;

-- Mitreisen bis und mit Starttag. Eine Obergrenze für Mitreisende gibt es nicht.
create or replace function public.check_trip_participant() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start date; v_seats int;
begin
  if public.uid() is null or public.is_admin() then return new; end if;
  select starts_on, seats into v_start, v_seats from public.trips where id = new.trip_id for update;
  if v_start < public.heute() then raise exception 'Die Reise hat schon begonnen'; end if;
  return new;
end $$;
drop trigger if exists trip_participant_check on public.trip_participants;
create trigger trip_participant_check before insert on public.trip_participants
  for each row execute function public.check_trip_participant();

-- Abmeldungen von Reisen, damit alle die Übersicht behalten. Wer sich abmeldet, ist nicht mehr dabei und umgekehrt.
create table if not exists public.trip_absagen (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  member_id  uuid not null default public.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, member_id)
);
alter table public.trip_absagen enable row level security;
create or replace function public.trip_absage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.uid() is not null and not public.is_admin() and (select starts_on from public.trips where id = new.trip_id) < public.heute() then
    raise exception 'Die Reise hat schon begonnen';
  end if;
  delete from public.trip_participants where trip_id = new.trip_id and member_id = new.member_id;
  return new;
end $$;
drop trigger if exists trip_absage on public.trip_absagen;
create trigger trip_absage before insert on public.trip_absagen for each row execute function public.trip_absage();
create or replace function public.trip_zusage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.trip_absagen where trip_id = new.trip_id and member_id = new.member_id;
  return new;
end $$;
drop trigger if exists trip_zusage on public.trip_participants;
create trigger trip_zusage after insert on public.trip_participants for each row execute function public.trip_zusage();

create table if not exists public.trip_photos (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  path        text not null,
  uploaded_by uuid default public.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.trip_photos enable row level security;
-- Reisefotos sehen nur die Mitreisenden. Was als Karte erscheinen soll, wählt wer es hochgeladen hat: Diese Fotos bilden
-- die Collage-Karte und sind für alle sichtbar. Standard: privat.
alter table public.trip_photos add column if not exists als_karte boolean not null default false;

-- Ämtli einer Reise als Liste: Person und Rolle (OK, Organisator, Kassier). Mehrere Personen pro Rolle möglich.
create table if not exists public.trip_aemtli (
  trip_id   uuid not null references public.trips(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  rolle     text not null check (rolle in ('ok', 'organisator', 'kassier')),
  added_by  uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (trip_id, member_id, rolle)
);
alter table public.trip_aemtli enable row level security;
-- Bisherige OK und Kassier in die Liste übernehmen (danach leer, damit ein Entfernen beim nächsten Einspielen nicht zurückkommt)
insert into public.trip_aemtli (trip_id, member_id, rolle, added_by)
select id, ok_id, 'ok', null::uuid from public.trips where ok_id is not null
union all select id, kassier_id, 'kassier', null::uuid from public.trips where kassier_id is not null
on conflict do nothing;
update public.trips set ok_id = null, kassier_id = null where ok_id is not null or kassier_id is not null;

create or replace function public.reise_dabei(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_participants where trip_id = p_trip and member_id = public.uid())
$$;
-- Wie viele Fotos eine Reise hat: das sehen auch die Daheimgebliebenen
create or replace function public.reise_fotos() returns table (trip_id uuid, anzahl int)
language sql stable security definer set search_path = public as $$
  select p.trip_id, count(*)::int from public.trip_photos p where public.is_member() group by p.trip_id
$$;
-- Hochladen nur für Mitreisende
create or replace function public.check_trip_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.uid() is not null and not public.is_admin() and not public.reise_dabei(new.trip_id) then
    raise exception 'Fotos laden nur Mitreisende hoch';
  end if;
  return new;
end $$;
drop trigger if exists trip_photo_check on public.trip_photos;
create trigger trip_photo_check before insert on public.trip_photos for each row execute function public.check_trip_photo();

-- Gäste bei Anlässen und Reisen: nur ein Name, kein Konto
create table if not exists public.gaeste (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references public.events(id) on delete cascade,
  trip_id    uuid references public.trips(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  added_by   uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(event_id, trip_id) = 1)
);
alter table public.gaeste enable row level security;

-- ───────────── Prost-Wand ─────────────
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid default public.uid() references public.profiles(id) on delete set null,
  text       text not null check (length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.posts enable row level security;

create table if not exists public.post_prosts (
  post_id   uuid not null references public.posts(id) on delete cascade,
  member_id uuid not null default public.uid() references public.profiles(id) on delete cascade,
  primary key (post_id, member_id)
);
alter table public.post_prosts enable row level security;

-- ───────────── Abstimmungen: Sacceri-Auszeichnung und Spitznamen ─────────────
-- Zweidrittelmehrheit der Stimmberechtigten, jede Stimme zählt gleich viel.
create table if not exists public.proposals (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('sacceri', 'nickname')),
  target_id    uuid not null references public.profiles(id) on delete cascade,
  trip_id      uuid references public.trips(id) on delete cascade,
  value        text check (length(value) <= 40),
  proposed_by  uuid not null references public.profiles(id) on delete cascade,
  seconded_by  uuid references public.profiles(id) on delete set null,
  voters       uuid[],                                                 -- Sacceri: Mitreisende beim Antrag
  status       text not null default 'open' check (status in ('open', 'passed', 'rejected')),
  yes_weight   int,
  total_weight int,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  check (kind <> 'sacceri' or trip_id is not null),
  check (kind <> 'nickname' or length(trim(coalesce(value, ''))) > 0)
);
alter table public.proposals enable row level security;
create unique index if not exists one_open_sacceri  on public.proposals (trip_id)   where status = 'open' and kind = 'sacceri';
create unique index if not exists one_open_nickname on public.proposals (target_id) where status = 'open' and kind = 'nickname';

create table if not exists public.ballots (
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  voter_id    uuid not null references public.profiles(id) on delete cascade,
  vote        boolean not null,
  created_at  timestamptz not null default now(),
  primary key (proposal_id, voter_id)
);
alter table public.ballots enable row level security;

-- Stimmberechtigt: Sacceri → die Mitreisenden beim Antrag ausser der vorgeschlagenen Person; Spitzname → alle ausser der Person selbst
create or replace function public.eligible_voters(p_proposal uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select v from public.proposals p, unnest(p.voters) v
   where p.id = p_proposal and p.kind = 'sacceri' and v <> p.target_id
  union
  select pr.id from public.proposals p join public.profiles pr on pr.id <> p.target_id
   where p.id = p_proposal and p.kind = 'nickname'
$$;

create or replace function public.resolve_proposal(p_proposal uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p public.proposals;
  v_total int; v_yes int; v_no int; v_need int; v_trip text;
begin
  select * into p from public.proposals where id = p_proposal for update;
  if not found then raise exception 'Abstimmung nicht gefunden'; end if;
  if p.status <> 'open' then return p.status; end if;
  if p.kind = 'nickname' and p.seconded_by is null then return 'open'; end if;

  select count(*) into v_total from public.eligible_voters(p.id) v;
  select count(*) filter (where b.vote), count(*) filter (where not b.vote)
    into v_yes, v_no
    from public.ballots b
   where b.proposal_id = p.id and b.voter_id in (select public.eligible_voters(p.id));
  v_need := ceil(v_total * 2.0 / 3.0);

  if v_total > 0 and v_yes >= v_need then
    update public.proposals set status = 'passed', yes_weight = v_yes, total_weight = v_total, decided_at = now() where id = p.id;
    if p.kind = 'nickname' then
      update public.profiles set nickname = p.value where id = p.target_id;
      insert into public.posts (author_id, text) values (p.target_id, 'heisst ab jetzt «' || p.value || '».');
    else
      update public.trips set sacceri_id = p.target_id where id = p.trip_id;
      select title into v_trip from public.trips where id = p.trip_id;
      insert into public.posts (author_id, text) values (p.target_id, 'ist De Sacceri der Reise ' || v_trip || '!');
    end if;
    return 'passed';
  elsif v_no > v_total - v_need then
    update public.proposals set status = 'rejected', yes_weight = v_yes, total_weight = v_total, decided_at = now() where id = p.id;
    return 'rejected';
  end if;
  return 'open';
end $$;

-- Sacceri beantragen (ein Mitglied stellt den Antrag und stimmt dabei mit Ja, falls mitgereist)
create or replace function public.propose_sacceri(p_trip uuid, p_target uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  if p_target = public.uid() then raise exception 'Du kannst dich nicht selbst auszeichnen'; end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip and member_id = p_target) then
    raise exception 'Nur Mitreisende können ausgezeichnet werden';
  end if;
  if (select sacceri_id from public.trips where id = p_trip) is not null then
    raise exception 'Diese Reise hat schon einen Sacceri';
  end if;
  insert into public.proposals (kind, target_id, trip_id, proposed_by, voters)
  values ('sacceri', p_target, p_trip, public.uid(), array(select member_id from public.trip_participants where trip_id = p_trip))
  returning id into v_id;
  if exists (select 1 from public.trip_participants where trip_id = p_trip and member_id = public.uid()) then
    insert into public.ballots (proposal_id, voter_id, vote) values (v_id, public.uid(), true);
  end if;
  perform public.resolve_proposal(v_id);
  return v_id;
end $$;

-- Spitzname vorschlagen; danach braucht es eine zweite Unterstützung, dann wird abgestimmt
create or replace function public.propose_nickname(p_target uuid, p_nick text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  if p_target = public.uid() then raise exception 'Spitznamen werden von anderen vergeben'; end if;
  insert into public.proposals (kind, target_id, value, proposed_by)
  values ('nickname', p_target, left(trim(p_nick), 40), public.uid()) returning id into v_id;
  insert into public.ballots (proposal_id, voter_id, vote) values (v_id, public.uid(), true);
  return v_id;
end $$;

create or replace function public.second_proposal(p_proposal uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p public.proposals;
begin
  if not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  select * into p from public.proposals where id = p_proposal for update;
  if not found or p.kind <> 'nickname' or p.status <> 'open' then raise exception 'Nicht möglich'; end if;
  if p.seconded_by is not null then raise exception 'Der Vorschlag ist schon unterstützt'; end if;
  if p.proposed_by = public.uid() or p.target_id = public.uid() then
    raise exception 'Die zweite Unterstützung muss von jemand anderem kommen';
  end if;
  update public.proposals set seconded_by = public.uid() where id = p.id;
  insert into public.ballots (proposal_id, voter_id, vote) values (p.id, public.uid(), true)
  on conflict (proposal_id, voter_id) do update set vote = true;
  return public.resolve_proposal(p.id);
end $$;

create or replace function public.cast_ballot(p_proposal uuid, p_yes boolean) returns text
language plpgsql security definer set search_path = public as $$
declare p public.proposals;
begin
  select * into p from public.proposals where id = p_proposal;
  if not found or p.status <> 'open' then raise exception 'Die Abstimmung ist abgeschlossen'; end if;
  if p.kind = 'nickname' and p.seconded_by is null then raise exception 'Erst braucht es eine zweite Unterstützung'; end if;
  if not exists (select 1 from public.eligible_voters(p.id) v where v = public.uid()) then
    raise exception 'Du bist für diese Abstimmung nicht stimmberechtigt';
  end if;
  insert into public.ballots (proposal_id, voter_id, vote) values (p.id, public.uid(), p_yes)
  on conflict (proposal_id, voter_id) do update set vote = excluded.vote, created_at = now();
  return public.resolve_proposal(p.id);
end $$;

-- ───────────── Sammelkarten ─────────────
create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(title) between 1 and 80),
  rarity      text not null check (rarity in ('magic', 'legend', 'geil')),
  story       text check (length(story) <= 1000),
  happened_on date,
  place       text check (length(place) <= 80),
  who         text check (length(who) <= 120),
  photo_path  text,
  created_by  uuid default public.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.cards enable row level security;

-- Wer auf einer Karte dabei war, bekommt Punkte. Eintragen darf, wer die Karte erstellt hat, oder der Admin.
create table if not exists public.card_members (
  card_id   uuid not null references public.cards(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  added_by  uuid default public.uid() references public.profiles(id) on delete set null,
  primary key (card_id, member_id)
);
alter table public.card_members enable row level security;

-- ───────────── Push-Nachrichten und Karte der Woche ─────────────
-- Nur für die Function "api": Schlüssel, Abos und was schon verschickt wurde. Keine Policy, kein Zugriff über die App.
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null
);
alter table public.push_config enable row level security;
create table if not exists public.push_abos (
  endpoint   text primary key,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_abos enable row level security;
create table if not exists public.push_log (
  art     text not null,
  ref     text not null,
  sent_at timestamptz not null default now(),
  primary key (art, ref)
);
alter table public.push_log enable row level security;
-- Warteschlange für sofortige Push-Nachrichten. Trigger legen ab, die Function verschickt (/push/senden, täglich als Rückfall).
-- an: nur an diese Person (sonst an alle); ausser: diese Person nicht (wer es ausgelöst hat).
create table if not exists public.push_queue (
  id         bigint generated always as identity primary key,
  titel      text not null,
  text       text not null,
  url        text not null default './',
  an         uuid references public.profiles(id) on delete cascade,
  ausser     uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
alter table public.push_queue enable row level security;

create or replace function public.push_name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), 'Jemand') from public.profiles where id = p
$$;
create or replace function public.push_datum(t timestamptz) returns text
language sql immutable set search_path = public as $$
  select (array['So','Mo','Di','Mi','Do','Fr','Sa'])[extract(dow from t at time zone 'Europe/Zurich')::int + 1] || ' '
    || to_char(t at time zone 'Europe/Zurich', 'DD.MM. "um" HH24:MI')
$$;

-- Neuer Anlass (von einem Mitglied erfasst, nicht die automatische Magnum-Serie) und neuer Organisator: an alle ausser wer es war
create or replace function public.push_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_at < now() then return new; end if;
  if tg_op = 'INSERT' and new.created_by is not null then
    insert into public.push_queue (titel, text, ausser)
    values ('Neuer Anlass: ' || new.title, public.push_datum(new.starts_at) || coalesce(' · ' || new.location, '') || '. Bist du dabei?', new.created_by);
  elsif tg_op = 'UPDATE' and new.organizer_id is not null and new.organizer_id is distinct from old.organizer_id
     -- Wer gerade einen Anlass erfasst und gleich selbst organisiert, bekommt keine zweite Meldung
     and not (old.organizer_id is null and new.created_by = new.organizer_id and new.created_at > now() - interval '5 minutes') then
    insert into public.push_queue (titel, text, ausser)
    values (new.title || ': ' || public.push_name(new.organizer_id) || case when old.organizer_id is null then ' organisiert' else ' übernimmt' end,
            case when old.organizer_id is null then public.push_name(new.organizer_id) || ' organisiert den Abend am ' || public.push_datum(new.starts_at) || '.'
                 else public.push_name(new.organizer_id) || ' übernimmt den Abend von ' || public.push_name(old.organizer_id) || '.' end,
            new.organizer_id);
  end if;
  return new;
end $$;
drop trigger if exists push_event on public.events;
create trigger push_event after insert or update of organizer_id on public.events for each row execute function public.push_event();

-- An- und Abmeldungen: an den Organisator und an alle, die schon dabei sind (auch virtuell), nie an sich selbst.
-- Die Anmeldung des Organisators selbst (claim_organizer) meldet nichts, das erledigt push_event.
create or replace function public.push_rsvp() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.events; n int;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select * into e from public.events where id = new.event_id;
  if e.starts_at < now() or new.member_id = e.organizer_id then return new; end if;
  select count(*) into n from public.rsvps where event_id = new.event_id and status = 'in';
  insert into public.push_queue (titel, text, an)
  select case new.status when 'in' then 'Anmeldung: ' when 'out' then 'Abmeldung: ' else 'Virtuell dabei: ' end || e.title,
         public.push_name(new.member_id) || case new.status when 'in' then ' ist dabei.' when 'out' then ' hat sich abgemeldet.' else ' ist virtuell dabei und spendiert eine Magnum.' end
           || ' Angemeldet: ' || n || '.',
         x.id
    from (select e.organizer_id as id union
          select member_id from public.rsvps where event_id = new.event_id and status in ('in', 'virtual')) x
   where x.id is not null and x.id <> new.member_id;
  return new;
end $$;
drop trigger if exists push_rsvp on public.rsvps;
create trigger push_rsvp after insert or update of status on public.rsvps for each row execute function public.push_rsvp();

-- Neue Abstimmung: Sacceri sofort beim Antrag, Spitzname sobald er unterstützt ist (erst dann wird abgestimmt)
create or replace function public.push_abstimmung() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titel text; v_text text; v_von uuid;
begin
  if new.status <> 'open' then return new; end if;
  if new.kind = 'sacceri' and tg_op = 'INSERT' then
    v_titel := 'Neue Abstimmung: De Sacceri';
    v_text := public.push_name(new.proposed_by) || ' schlägt ' || public.push_name(new.target_id) || ' vor (Reise ' || coalesce((select title from public.trips where id = new.trip_id), '') || '). Stimm ab!';
    v_von := new.proposed_by;
  elsif new.kind = 'nickname' and tg_op = 'UPDATE' and old.seconded_by is null and new.seconded_by is not null then
    v_titel := 'Neue Abstimmung: Spitzname';
    v_text := '«' || new.value || '» für ' || public.push_name(new.target_id) || '? Stimm ab!';
    v_von := new.seconded_by;
  else
    return new;
  end if;
  insert into public.push_queue (titel, text, an)
  select v_titel, v_text, v from public.eligible_voters(new.id) v
   where v <> v_von and v <> new.proposed_by and v is distinct from new.seconded_by;
  return new;
end $$;
drop trigger if exists push_abstimmung on public.proposals;
create trigger push_abstimmung after insert or update of seconded_by on public.proposals for each row execute function public.push_abstimmung();

-- Jede Woche wird eine Sammelkarte aufgedeckt, aber nur für 3 Mitglieder (karte_der_woche_fuer). So bleibt es spannend:
-- Alle anderen sehen bis zur nächsten Woche nur, für wen sie aufgedeckt ist.
create table if not exists public.karte_der_woche (
  woche   date primary key,
  card_id uuid not null references public.cards(id) on delete cascade
);
alter table public.karte_der_woche enable row level security;
create table if not exists public.karte_der_woche_fuer (
  woche     date not null references public.karte_der_woche(woche) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  primary key (woche, member_id)
);
alter table public.karte_der_woche_fuer enable row level security;

-- ───────────── Getränkefotos (Trinkfestigkeit) ─────────────
create table if not exists public.drinks (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null default public.uid() references public.profiles(id) on delete cascade,
  drunk_on   date not null default current_date,
  kind       text not null check (kind in ('wein', 'bier', 'schnaps', 'magnum', 'wasser')),
  photo_path text,
  created_at timestamptz not null default now()
);
alter table public.drinks enable row level security;

-- ───────────── Spruch des Tages ─────────────
-- Das Phrasenschwein gibt es nicht mehr
drop table if exists public.phrases;
drop function if exists public.set_phrase_fee();
alter table public.settings drop column if exists phrase_fee;

create table if not exists public.sayings (
  id         uuid primary key default gen_random_uuid(),
  text       text not null check (length(text) between 1 and 280),
  author_id  uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sayings enable row level security;

create table if not exists public.saying_prosts (
  saying_id uuid not null references public.sayings(id) on delete cascade,
  member_id uuid not null default public.uid() references public.profiles(id) on delete cascade,
  primary key (saying_id, member_id)
);
alter table public.saying_prosts enable row level security;

-- Den Zeitpunkt legt der Server fest, nicht die App
create or replace function public.set_created_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.uid() is not null then new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists created_at_set on public.posts;
create trigger created_at_set before insert on public.posts for each row execute function public.set_created_at();
drop trigger if exists created_at_set on public.sayings;
create trigger created_at_set before insert on public.sayings for each row execute function public.set_created_at();


-- ───────────── Verbesserungsvorschläge → GitHub-Issues ─────────────
-- Geschrieben nur von der Function "api", die als Datenbank-Besitzer läuft.
create table if not exists public.feedback (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references neon_auth."user"(id) on delete cascade,
  kind         text not null default 'idee' check (kind in ('idee', 'fehler', 'wunsch')),
  title        text not null,
  body         text not null,
  labels       text[] not null default '{}',
  status       text not null default 'neu' check (status in ('neu', 'erfasst', 'fehler', 'umgesetzt', 'geschlossen')),
  issue_number int,
  issue_url    text,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists feedback_status on public.feedback (status, created_at);
alter table public.feedback enable row level security;

-- ───────────── Videokarten: verdeckter Stapel, gezogen wird am Magnum-Abend ─────────────
-- Hochladen dürfen alle. Sehen darf ein Video nur, wer es hochgeladen oder gezogen hat, und der Admin.
create table if not exists public.video_karten (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) between 1 and 80),
  path       text not null unique check (path ~ '^videos/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}\.(mp4|webm)$'),
  created_by uuid default public.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.video_karten enable row level security;
-- Eine Karte pro Person und Anlass. Nur über karte_ziehen().
create table if not exists public.video_ziehungen (
  event_id   uuid not null references public.events(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  karte_id   uuid not null references public.video_karten(id) on delete cascade,
  gezogen_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
alter table public.video_ziehungen enable row level security;

-- ───────────── Volle Gläser: Karten liken ─────────────
-- karte: «karte-<id>» (Sammelkarte), «video-<id>» (Videokarte), «sac-<reise>» und «col-<reise>» (Sacceri- und Collage-Karte).
-- Geheime Karten gehören jeder Person allein und bekommen keine Gläser.
create table if not exists public.karten_glaeser (
  karte      text not null check (karte ~ '^(karte|video|sac|col)-[0-9a-f-]{36}$'),
  member_id  uuid not null default public.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (karte, member_id)
);
alter table public.karten_glaeser enable row level security;

-- Ein Glas nur für Karten, die es gibt und die man sehen darf (Videokarten: hochgeladen, gezogen oder Admin)
create or replace function public.check_glas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_art text := split_part(new.karte, '-', 1); v_id uuid;
begin
  -- Falsches Format: Das meldet die check-Bedingung der Tabelle
  if public.uid() is null or new.karte !~ '^(karte|video|sac|col)-[0-9a-f-]{36}$' then return new; end if;
  v_id := substr(new.karte, length(v_art) + 2)::uuid;
  if v_art = 'karte' and not exists (select 1 from public.cards where id = v_id)
     or v_art = 'video' and not exists (select 1 from public.video_karten k where k.id = v_id and (k.created_by = public.uid() or public.is_admin()
          or exists (select 1 from public.video_ziehungen z where z.karte_id = k.id and z.member_id = public.uid())))
     or v_art = 'sac' and not exists (select 1 from public.trips where id = v_id and sacceri_id is not null)
     or v_art = 'col' and not exists (select 1 from public.trip_photos where trip_id = v_id and als_karte) then
    raise exception 'Diese Karte gibt es nicht';
  end if;
  return new;
end $$;
drop trigger if exists glas_check on public.karten_glaeser;
create trigger glas_check before insert or update on public.karten_glaeser for each row execute function public.check_glas();

-- Volles Glas: Wer die Karte erstellt oder hochgeladen hat, bekommt eine Push-Nachricht (nicht für eigene Gläser).
-- Pro Person und Karte nur einmal, auch wenn jemand das Glas zurücknimmt und wieder gibt.
create or replace function public.glas_menge(n int) returns text
language sql immutable set search_path = public as $$
  select concat_ws(' und ',
    case when n / 4 = 1 then '1 Flasche' when n / 4 > 1 then (n / 4) || ' Flaschen' end,
    case when n % 4 = 1 then '1 volles Glas' when n % 4 > 1 or n = 0 then (n % 4) || ' volle Gläser' end)
$$;
create or replace function public.push_glas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_art text := split_part(new.karte, '-', 1); v_id uuid; v_von uuid; v_titel text; n int;
begin
  if new.karte !~ '^(karte|video)-[0-9a-f-]{36}$' then return new; end if;
  v_id := substr(new.karte, length(v_art) + 2)::uuid;
  if v_art = 'karte' then select created_by, title into v_von, v_titel from public.cards where id = v_id;
  else select created_by, title into v_von, v_titel from public.video_karten where id = v_id; end if;
  if v_von is null or v_von = new.member_id then return new; end if;
  insert into public.push_log (art, ref) values ('glas', new.karte || '/' || new.member_id) on conflict do nothing;
  if not found then return new; end if;
  select count(*) into n from public.karten_glaeser where karte = new.karte;
  insert into public.push_queue (titel, text, an)
  values ('🍷 Volles Glas für «' || v_titel || '»', public.push_name(new.member_id) || ' hat deiner Karte ein volles Glas gegeben. Jetzt: ' || public.glas_menge(n) || '.', v_von);
  return new;
end $$;
drop trigger if exists push_glas on public.karten_glaeser;
create trigger push_glas after insert on public.karten_glaeser for each row execute function public.push_glas();

-- Wird die Karte gelöscht, gehen die Gläser mit
create or replace function public.glaeser_weg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'cards' then delete from public.karten_glaeser where karte = 'karte-' || old.id;
  elsif tg_table_name = 'video_karten' then delete from public.karten_glaeser where karte = 'video-' || old.id;
  else delete from public.karten_glaeser where karte in ('sac-' || old.id, 'col-' || old.id); end if;
  return old;
end $$;
drop trigger if exists glaeser_weg on public.cards;
create trigger glaeser_weg after delete on public.cards for each row execute function public.glaeser_weg();
drop trigger if exists glaeser_weg on public.video_karten;
create trigger glaeser_weg after delete on public.video_karten for each row execute function public.glaeser_weg();
drop trigger if exists glaeser_weg on public.trips;
create trigger glaeser_weg after delete on public.trips for each row execute function public.glaeser_weg();

-- Wie viele Videokarten es gibt (auch die verdeckten), damit alle ihren Anteil sehen
create or replace function public.video_bestand() returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_member() then (select count(*)::int from public.video_karten) else 0 end
$$;

-- Wie viele Karten ich noch ziehen könnte (nicht eigene, nicht schon gezogene)
create or replace function public.video_ziehbar() returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_member() then (select count(*)::int from public.video_karten k
    where k.created_by is distinct from public.uid()
      and not exists (select 1 from public.video_ziehungen z where z.karte_id = k.id and z.member_id = public.uid())) else 0 end
$$;

-- Ziehen: vom Beginn des Anlasses bis am nächsten Tag um 12 Uhr, wer dabei oder virtuell dabei ist.
-- Nie die eigene, nie eine schon gezogene; am gleichen Abend möglichst nicht dieselbe wie jemand anderes.
create or replace function public.karte_ziehen(p_event uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_ende timestamptz; v_karte uuid;
begin
  if not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  select starts_at into v_start from public.events where id = p_event;
  if v_start is null then raise exception 'Anlass nicht gefunden'; end if;
  v_ende := (((v_start at time zone 'Europe/Zurich')::date + 1) + time '12:00') at time zone 'Europe/Zurich';
  if now() < v_start then raise exception 'Karten gibt es erst am Abend selbst'; end if;
  if now() > v_ende then raise exception 'Ziehen ging bis am nächsten Mittag'; end if;
  if not exists (select 1 from public.rsvps where event_id = p_event and member_id = public.uid() and status in ('in', 'virtual')) then
    raise exception 'Karten gibt es nur für alle, die dabei sind';
  end if;
  if exists (select 1 from public.video_ziehungen where event_id = p_event and member_id = public.uid()) then
    raise exception 'Du hast deine Karte für diesen Abend schon gezogen';
  end if;
  perform pg_advisory_xact_lock(hashtext('karte_ziehen:' || p_event));
  select k.id into v_karte from public.video_karten k
   where k.created_by is distinct from public.uid()
     and not exists (select 1 from public.video_ziehungen z where z.karte_id = k.id and z.member_id = public.uid())
   order by exists (select 1 from public.video_ziehungen z where z.karte_id = k.id and z.event_id = p_event), random()
   limit 1;
  if v_karte is null then raise exception 'Keine neue Karte im Stapel. Lade eine hoch!'; end if;
  insert into public.video_ziehungen (event_id, member_id, karte_id) values (p_event, public.uid(), v_karte);
  return v_karte;
end $$;

-- Live-Sync: Jede Änderung erhöht den Stand, die offene App fragt danach (app/client.js)
create table if not exists public.sync_stand (
  id    int primary key default 1 check (id = 1),
  stand bigint not null default 0
);
alter table public.sync_stand enable row level security;
insert into public.sync_stand (id) values (1) on conflict do nothing;
create or replace function public.sync_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.sync_stand set stand = stand + 1 where id = 1;
  return null;
end $$;

-- ═════════════ Zugriffsregeln (Row Level Security) ═════════════

-- Die Data API läuft als Rolle "authenticated". Was sie darf, regeln danach Spalten-Rechte und Policies.
grant usage on schema public to anonymous, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on table public.invites, public.magnum_serie, public.push_config, public.push_abos, public.push_log, public.push_queue from anonymous, authenticated;
revoke insert, update, delete on public.karte_der_woche from authenticated;
revoke insert, update, delete on public.karte_der_woche_fuer from authenticated;
revoke insert, update, delete on public.video_ziehungen from authenticated;
revoke update on public.video_karten from authenticated;
revoke update on public.trip_aemtli from authenticated;
revoke update on public.trip_photos from authenticated;
grant update (als_karte) on public.trip_photos to authenticated;
grant select on public.app_status to anonymous;

-- Lesen: alle Mitglieder (Einladungen nie direkt, nur über die Edge Function)
do $$
declare t text;
begin
  foreach t in array array['settings', 'profiles', 'admin_log', 'restaurants', 'restaurant_visits',
    'restaurant_ratings', 'events', 'rsvps', 'magnums', 'magnum_guests', 'rides', 'ride_passengers', 'trips',
    'trip_participants', 'trip_aemtli', 'trip_absagen', 'proposals', 'ballots', 'posts', 'post_prosts', 'cards', 'drinks',
    'sayings', 'saying_prosts', 'feedback', 'sync_stand', 'card_members', 'gaeste', 'karte_der_woche_fuer', 'video_ziehungen', 'karten_glaeser']
  loop
    execute format('drop policy if exists "Mitglieder lesen" on public.%I', t);
    execute format('create policy "Mitglieder lesen" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- Karte der Woche: In der laufenden Woche sehen sie nur die 3, für die sie aufgedeckt ist. Ältere Wochen und Wochen ohne Auswahl sehen alle.
drop policy if exists "Mitglieder lesen" on public.trip_photos;
drop policy if exists "Reisefotos sehen" on public.trip_photos;
create policy "Reisefotos sehen" on public.trip_photos for select to authenticated using (public.is_member() and (als_karte or public.reise_dabei(trip_id)));
-- Ämtli: alle Mitglieder tragen ein und entfernen (wie bisher OK und Kassier)
drop policy if exists "Ämtli eintragen" on public.trip_aemtli;
drop policy if exists "Ämtli entfernen" on public.trip_aemtli;
create policy "Ämtli eintragen" on public.trip_aemtli for insert to authenticated with check (public.is_member() and added_by = public.uid());
create policy "Ämtli entfernen" on public.trip_aemtli for delete to authenticated using (public.is_member());
drop policy if exists "Mitglieder lesen" on public.karte_der_woche;
drop policy if exists "Karte der Woche lesen" on public.karte_der_woche;
create or replace function public.kdw_sichtbar(p_woche date) returns boolean
language sql stable security definer set search_path = public as $$
  select p_woche < date_trunc('week', public.heute()::timestamp)::date
    or not exists (select 1 from public.karte_der_woche_fuer f where f.woche = p_woche)
    or exists (select 1 from public.karte_der_woche_fuer f where f.woche = p_woche and f.member_id = public.uid())
$$;
revoke execute on function public.kdw_sichtbar(date) from public, anonymous;
grant execute on function public.kdw_sichtbar(date) to authenticated;
create policy "Karte der Woche lesen" on public.karte_der_woche for select to authenticated using (public.is_member() and public.kdw_sichtbar(woche));

-- Persönliche Einträge: anlegen/ändern nur die Person selbst, löschen sie selbst oder der Admin
do $$
declare r record;
begin
  for r in select * from (values
    ('restaurant_ratings', 'member_id'), ('rsvps', 'member_id'), ('trip_participants', 'member_id'),
    ('drinks', 'member_id'), ('saying_prosts', 'member_id'), ('post_prosts', 'member_id'), ('karten_glaeser', 'member_id'), ('trip_absagen', 'member_id'),
    ('ride_passengers', 'passenger_id'), ('rides', 'driver_id')
  ) as x(tbl, col)
  loop
    execute format('drop policy if exists "Eigene anlegen" on public.%I', r.tbl);
    execute format('drop policy if exists "Eigene ändern" on public.%I', r.tbl);
    execute format('drop policy if exists "Eigene löschen" on public.%I', r.tbl);
    execute format('create policy "Eigene anlegen" on public.%I for insert to authenticated with check (public.is_member() and %I = public.uid())', r.tbl, r.col);
    execute format('create policy "Eigene ändern" on public.%I for update to authenticated using (%I = public.uid()) with check (%I = public.uid())', r.tbl, r.col, r.col);
    execute format('create policy "Eigene löschen" on public.%I for delete to authenticated using (%I = public.uid() or public.is_admin())', r.tbl, r.col);
  end loop;
end $$;

-- Gemeinsame Inhalte: alle Mitglieder legen an, Ersteller oder Admin ändert/löscht
do $$
declare r record;
begin
  for r in select * from (values
    ('restaurants', 'created_by'), ('restaurant_visits', 'created_by'), ('events', 'created_by'),
    ('magnums', 'brought_by'), ('magnum_guests', 'added_by'), ('trip_photos', 'uploaded_by'),
    ('cards', 'created_by'), ('gaeste', 'added_by'), ('sayings', 'author_id'), ('posts', 'author_id')
  ) as x(tbl, col)
  loop
    execute format('drop policy if exists "Mitglieder anlegen" on public.%I', r.tbl);
    execute format('drop policy if exists "Ersteller ändern" on public.%I', r.tbl);
    execute format('drop policy if exists "Ersteller löschen" on public.%I', r.tbl);
    execute format('create policy "Mitglieder anlegen" on public.%I for insert to authenticated with check (public.is_member() and %I = public.uid())', r.tbl, r.col);
    execute format('create policy "Ersteller ändern" on public.%I for update to authenticated using (%I = public.uid() or public.is_admin())', r.tbl, r.col);
    execute format('create policy "Ersteller löschen" on public.%I for delete to authenticated using (%I = public.uid() or public.is_admin())', r.tbl, r.col);
  end loop;
end $$;

-- Personen auf Karten: Ersteller der Karte oder Admin
drop policy if exists "Karte eintragen" on public.card_members;
drop policy if exists "Karte austragen" on public.card_members;
create policy "Karte eintragen" on public.card_members for insert to authenticated with check (
  added_by = public.uid() and (public.is_admin() or exists (select 1 from public.cards c where c.id = card_id and c.created_by = public.uid())));
create policy "Karte austragen" on public.card_members for delete to authenticated using (
  public.is_admin() or exists (select 1 from public.cards c where c.id = card_id and c.created_by = public.uid()));
revoke update on public.card_members from authenticated;

-- Videokarten: Inhalt nur für wer sie hochgeladen oder gezogen hat und den Admin.
-- Löschen: der Admin immer, wer hochgeladen hat nur, solange niemand sie gezogen hat.
drop policy if exists "Video sehen" on public.video_karten;
drop policy if exists "Video hochladen" on public.video_karten;
drop policy if exists "Video löschen" on public.video_karten;
create policy "Video sehen" on public.video_karten for select to authenticated using (
  public.is_member() and (created_by = public.uid() or public.is_admin()
    or exists (select 1 from public.video_ziehungen z where z.karte_id = id and z.member_id = public.uid())));
create policy "Video hochladen" on public.video_karten for insert to authenticated with check (
  public.is_member() and created_by = public.uid() and path like 'videos/' || public.uid()::text || '/%');
create policy "Video löschen" on public.video_karten for delete to authenticated using (
  public.is_admin() or (created_by = public.uid() and not exists (select 1 from public.video_ziehungen z where z.karte_id = id)));

-- Anlässe: Auch wer organisiert, passt Name, Datum und Ort an
drop policy if exists "Ersteller ändern" on public.events;
create policy "Ersteller ändern" on public.events for update to authenticated
  using (created_by = public.uid() or organizer_id = public.uid() or public.is_admin());

-- Reisen: alle Mitglieder legen an und tragen OK/Kassier ein (Rest siehe check_trip). Der Sacceri kommt nur per Abstimmung.
drop policy if exists "Reisen anlegen" on public.trips;
drop policy if exists "Reisen ändern" on public.trips;
drop policy if exists "Reisen löschen" on public.trips;
create policy "Reisen anlegen" on public.trips for insert to authenticated
  with check (public.is_member() and created_by = public.uid() and sacceri_id is null);
create policy "Reisen ändern" on public.trips for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy "Reisen löschen" on public.trips for delete to authenticated using (created_by = public.uid() or public.is_admin());
revoke update on public.trips from authenticated;
grant update (title, starts_on, ends_on, program, seats, color, ok_id, kassier_id) on public.trips to authenticated;

-- Profil: nur eigene, harmlose Felder. Gerät, Spitzname, Funktion und Admin nur über Funktionen.
drop policy if exists "Eigenes Profil ändern" on public.profiles;
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated
  using (id = public.uid()) with check (id = public.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, fav_wine, specialty) on public.profiles to authenticated;

-- Anlässe: Organisator nur über claim_organizer (beim Anlegen siehe check_event)
revoke update on public.events from authenticated;
grant update (title, starts_at, location, ortschaft) on public.events to authenticated;

-- Anmeldungen: "redeemed" setzt nur die Kasse. Der Schlüssel muss in der Liste stehen, weil ein Upsert
-- über die API alle gesendeten Spalten aktualisiert (check_rsvp lässt ihn nicht ändern).
revoke insert, update on public.rsvps from authenticated;
grant insert (event_id, member_id, status, updated_at) on public.rsvps to authenticated;
grant update (event_id, member_id, status, updated_at) on public.rsvps to authenticated;

-- Fahrangebote ändert niemand nachträglich (sonst weniger Plätze als Mitfahrer); zurückziehen geht
revoke update on public.rides from authenticated;

-- Fahrten bewerten: Passagiere ändern nur die Bewertung, nicht die Fahrt
revoke update on public.ride_passengers from authenticated;
grant update (stars_safe, stars_punctual, stars_mood, points_given, rated_at) on public.ride_passengers to authenticated;

-- Beiträge: nur der Text ist nachträglich änderbar, der Zeitpunkt nicht
revoke update on public.posts, public.sayings from authenticated;
grant update (text) on public.posts, public.sayings to authenticated;

-- ═════════════ Funktionsrechte ═════════════
-- In Postgres darf standardmässig jeder (PUBLIC) Funktionen ausführen – deshalb überall explizit entziehen.
alter default privileges in schema public revoke execute on functions from public;
revoke execute on function public.is_member() from public, anonymous;
revoke execute on function public.is_admin() from public, anonymous;
revoke execute on function public.me() from public, anonymous;
revoke execute on function public.admin_set_device(uuid, text) from public, anonymous;
revoke execute on function public.admin_set_role(uuid, text) from public, anonymous;
revoke execute on function public.admin_set_admin(uuid, boolean) from public, anonymous;
revoke execute on function public.claim_organizer(uuid, uuid) from public, anonymous;
revoke execute on function public.set_organizer(uuid, uuid) from public, anonymous;
revoke execute on function public.open_magnum_kasse() from public, anonymous;
revoke execute on function public.eligible_voters(uuid) from public, anonymous;
revoke execute on function public.resolve_proposal(uuid) from public, anonymous, authenticated;
revoke execute on function public.propose_sacceri(uuid, uuid) from public, anonymous;
revoke execute on function public.propose_nickname(uuid, text) from public, anonymous;
revoke execute on function public.second_proposal(uuid) from public, anonymous;
revoke execute on function public.cast_ballot(uuid, boolean) from public, anonymous;
revoke execute on function public.handle_new_user() from public, anonymous, authenticated;
revoke execute on function public.gate_new_user() from public, anonymous, authenticated;
revoke execute on function public.letzter_freitag(date) from public, anonymous, authenticated;
revoke execute on function public.magnum_titel(date) from public, anonymous, authenticated;
revoke execute on function public.magnum_termine() from public, anonymous;
revoke execute on function public.admin_set_rsvp(uuid, uuid, text) from public, anonymous;
revoke execute on function public.sync_bump() from public, anonymous, authenticated;
revoke execute on function public.check_ride_passenger() from public, anonymous, authenticated;
revoke execute on function public.heute() from public, anonymous, authenticated;
revoke execute on function public.check_event() from public, anonymous, authenticated;
revoke execute on function public.check_rsvp() from public, anonymous, authenticated;
revoke execute on function public.push_abstimmung() from public, anonymous, authenticated;
revoke execute on function public.check_trip_photo() from public, anonymous, authenticated;
revoke execute on function public.trip_absage() from public, anonymous, authenticated;
revoke execute on function public.trip_zusage() from public, anonymous, authenticated;
revoke execute on function public.reise_dabei(uuid) from public, anonymous;
grant execute on function public.reise_dabei(uuid) to authenticated;
revoke execute on function public.reise_fotos() from public, anonymous;
grant execute on function public.reise_fotos() to authenticated;
revoke execute on function public.push_event() from public, anonymous, authenticated;
revoke execute on function public.push_rsvp() from public, anonymous, authenticated;
revoke execute on function public.push_glas() from public, anonymous, authenticated;
revoke execute on function public.push_name(uuid) from public, anonymous, authenticated;
revoke execute on function public.push_datum(timestamptz) from public, anonymous, authenticated;
revoke execute on function public.glas_menge(int) from public, anonymous, authenticated;
revoke execute on function public.check_glas(), public.glaeser_weg() from public, anonymous, authenticated;
revoke execute on function public.check_trip() from public, anonymous, authenticated;
revoke execute on function public.check_trip_participant() from public, anonymous, authenticated;
revoke execute on function public.set_created_at() from public, anonymous, authenticated;
revoke execute on function public.video_bestand() from public, anonymous;
revoke execute on function public.video_ziehbar() from public, anonymous;
revoke execute on function public.karte_ziehen(uuid) from public, anonymous;
grant execute on function public.is_member(), public.is_admin(), public.me(), public.magnum_termine(), public.admin_set_rsvp(uuid, uuid, text),
  public.admin_set_device(uuid, text), public.admin_set_role(uuid, text), public.admin_set_admin(uuid, boolean), public.claim_organizer(uuid, uuid), public.set_organizer(uuid, uuid),
  public.open_magnum_kasse(), public.eligible_voters(uuid), public.propose_sacceri(uuid, uuid),
  public.propose_nickname(uuid, text), public.second_proposal(uuid), public.cast_ballot(uuid, boolean),
  public.video_bestand(), public.video_ziehbar(), public.karte_ziehen(uuid)
  to authenticated;

-- ═════════════ Live-Sync: Änderungen melden ═════════════
do $$
declare t text;
begin
  foreach t in array array['profiles', 'events', 'rsvps', 'magnums', 'magnum_guests', 'rides', 'ride_passengers',
    'trips', 'trip_participants', 'trip_photos', 'trip_aemtli', 'trip_absagen', 'proposals', 'ballots', 'posts', 'post_prosts', 'cards', 'drinks',
    'sayings', 'saying_prosts', 'card_members', 'gaeste', 'karte_der_woche', 'karte_der_woche_fuer', 'video_karten', 'video_ziehungen', 'karten_glaeser', 'restaurants', 'restaurant_visits', 'restaurant_ratings', 'feedback', 'admin_log']
  loop
    execute format('drop trigger if exists sync_bump on public.%I', t);
    execute format('create trigger sync_bump after insert or update or delete on public.%I for each statement execute function public.sync_bump()', t);
  end loop;
end $$;

-- ═════════════ Datensicherung ═════════════
-- Vor jedem Release und täglich wird der ganze Club als JSON gesichert (ohne Fotos, die liegen im Speicher).
-- Niemand kommt über die App an die Sicherungen: keine Policy, Funktionen nur im SQL Editor / Release / Cron.
create table if not exists public.backups (
  id       bigint generated always as identity primary key,
  reason   text not null,
  data     jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists backups_saved_at on public.backups (saved_at desc);
alter table public.backups enable row level security;
revoke all on table public.backups from anonymous, authenticated;

-- Alle Tabellen in der Reihenfolge der Fremdschlüssel: referenzierte zuerst. Neue Tabellen sind automatisch dabei.
create or replace function public.backup_tables() returns text[]
language plpgsql stable set search_path = public as $$
declare rest text[]; frei text[]; fertig text[] := '{}';
begin
  select array_agg(c.relname::text) into rest from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('backups', 'schema_migrations', 'app_status', 'sync_stand', 'push_config', 'push_abos', 'push_log', 'push_queue');
  while cardinality(rest) > 0 loop
    select array_agg(t) into frei from unnest(rest) t
    where not exists (
      select 1 from pg_constraint k join pg_class z on z.oid = k.confrelid
      where k.contype = 'f' and k.conrelid = format('public.%I', t)::regclass
        and k.confrelid <> k.conrelid and z.relname::text = any(rest) and z.relname::text <> t);
    if frei is null then raise exception 'Fremdschlüssel im Kreis: %', rest; end if;
    fertig := fertig || frei;
    rest := array(select unnest(rest) except select unnest(frei));
  end loop;
  return fertig;
end $$;
revoke execute on function public.backup_tables() from public, anonymous, authenticated;

create or replace function public.snapshot_club(p_reason text default 'manuell') returns bigint
language plpgsql set search_path = public as $$
declare t text; zeilen jsonb; alles jsonb := '{}'; hid bigint;
begin
  foreach t in array public.backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into zeilen;
    alles := alles || jsonb_build_object(t, zeilen);
  end loop;
  insert into public.backups (reason, data) values (coalesce(nullif(trim(p_reason), ''), 'manuell'), alles)
  returning id into hid;
  delete from public.backups where reason = 'täglich' and saved_at < now() - interval '30 days';
  delete from public.backups where id in (
    select id from public.backups where reason like 'vor Release%' order by saved_at desc, id desc offset 30);
  return hid;
end $$;
revoke execute on function public.snapshot_club(text) from public, anonymous, authenticated;

-- Stand wiederherstellen, nur im SQL Editor: select public.restore_club(<id>);
-- Läuft als eine Transaktion: Scheitert etwas, bleibt alles wie es war. Der aktuelle Stand wird vorher gesichert.
create or replace function public.restore_club(p_backup bigint) returns void
language plpgsql set search_path = public as $$
declare d jsonb; tabellen text[]; t text; i int;
begin
  select data into d from public.backups where id = p_backup;
  if d is null then raise exception 'Sicherung % nicht gefunden', p_backup; end if;
  perform public.snapshot_club('vor Wiederherstellung');
  tabellen := public.backup_tables();
  for i in reverse cardinality(tabellen)..1 loop
    execute format('delete from public.%I', tabellen[i]);
  end loop;
  foreach t in array tabellen loop
    if d ? t then
      execute format('insert into public.%I overriding system value select * from jsonb_populate_recordset(null::public.%I, $1)', t, t)
      using d -> t;
    end if;
  end loop;
end $$;
revoke execute on function public.restore_club(bigint) from public, anonymous, authenticated;

-- Sicherung und Magnum-Serie startet täglich ein Function Trigger (neon.ts): pg_cron läuft nicht, solange die Datenbank schläft.

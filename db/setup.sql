-- Magnum – Datenbank einrichten.
-- Spielt der Release-Workflow ein (Neon Auth und Data API müssen aktiv sein). Mehrfaches Ausführen ist unproblematisch.
-- Grundsatz: Mitglieder sehen alles im Club und ändern nur ihre eigenen Einträge.
-- Ohne Login sieht man nichts. Abstimmungen, Einladungen und Admin-Rechte laufen nur über Funktionen.

-- ───────────── Einstellungen & Wartung ─────────────
create table if not exists public.settings (
  id           int primary key default 1 check (id = 1),
  max_members  int  not null default 12,
  goal_title   text not null default '30 Zusagen bis zum Chlaus-Magnum = Apéro für alle',
  goal_target  int  not null default 30,
  phrase_fee   numeric(6,2) not null default 2,
  magnum_price numeric(6,2) not null default 45
);
alter table public.settings enable row level security;
insert into public.settings (id) values (1) on conflict do nothing;

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
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Bei Abstimmungen zählen Android-Stimmen doppelt, sobald der Admin das Gerät bestätigt hat.
-- Das Gerät aus der Registrierung ist nur eine Angabe der App und lässt sich nicht prüfen.
create or replace function public.vote_weight(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when device = 'android' and device_set_by_admin then 2 else 1 end from public.profiles where id = p_member
$$;

-- Heutiger Tag im Club. Die Fristen unten gelten nur für Anfragen aus der App (auth.uid() gesetzt):
-- Wiederherstellung, Release und SQL Editor laufen ohne Login und sind nicht betroffen.
create or replace function public.heute() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Zurich')::date
$$;

-- Der Club hat höchstens settings.max_members Mitglieder. Die Sperre lässt parallele Beitritte warten.
create or replace function public.check_club_size() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  select max_members into v_max from public.settings where id = 1 for update;
  if (select count(*) from public.profiles) >= v_max then raise exception 'Der Club ist voll'; end if;
  return new;
end $$;
drop trigger if exists club_size_check on public.profiles;
create trigger club_size_check before insert on public.profiles
  for each row execute function public.check_club_size();

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
  select * into r from public.profiles where id = auth.uid();
  if not found then return null; end if;
  update public.profiles set last_seen = now() where id = auth.uid();
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
declare v_old text; v_bestaetigt boolean;
begin
  if not public.is_admin() then raise exception 'Nur der Administrator darf den Gerätetyp ändern'; end if;
  if p_device not in ('iphone', 'android') then raise exception 'Unbekannter Gerätetyp'; end if;
  select device, device_set_by_admin into v_old, v_bestaetigt from public.profiles where id = p_member;
  if v_old is null then raise exception 'Mitglied nicht gefunden'; end if;
  if v_old = p_device and (v_bestaetigt or p_device = 'iphone') then return; end if;
  update public.profiles set device = p_device, device_set_by_admin = true where id = p_member;
  insert into public.admin_log (admin_id, member_id, action)
  values (auth.uid(), p_member, case when v_old = p_device then 'Gerätetyp ' || p_device || ' bestätigt' else 'Gerätetyp ' || v_old || ' → ' || p_device end);
end $$;

create or replace function public.admin_set_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Administrator darf Funktionen vergeben'; end if;
  update public.profiles set role_title = left(trim(p_role), 40) where id = p_member;
  insert into public.admin_log (admin_id, member_id, action) values (auth.uid(), p_member, 'Funktion → ' || left(trim(p_role), 40));
end $$;

-- ───────────── Restaurants ─────────────
create table if not exists public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  place      text check (length(place) <= 80),
  lat        double precision,
  lng        double precision,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
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
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.restaurant_visits enable row level security;

create table if not exists public.restaurant_ratings (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  member_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
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
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.events enable row level security;

-- Keine erfundenen Anlässe in der Vergangenheit, der Organisator kommt nur über claim_organizer.
-- Vergangenes trägt der Admin nach.
create or replace function public.check_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
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
  member_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status     text not null check (status in ('in', 'out', 'virtual')),
  redeemed   boolean not null default false,   -- gespendete Magnum aus der Kasse geöffnet
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
alter table public.rsvps enable row level security;

-- An- und abmelden bis und mit Anlasstag. Danach gilt die Anwesenheit (Punkte, Streak, Kasse).
create or replace function public.check_rsvp() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tag date;
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'Der Anlass lässt sich nicht ändern'; end if;
    select (starts_at at time zone 'Europe/Zurich')::date into v_tag from public.events
     where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
    if v_tag < public.heute() then raise exception 'Der Anlass ist vorbei, die Anmeldung ist geschlossen'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists rsvp_check on public.rsvps;
create trigger rsvp_check before insert or update or delete on public.rsvps
  for each row execute function public.check_rsvp();

-- "Ich organisiere den Abend": nur solange niemand organisiert
create or replace function public.claim_organizer(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Nur Mitglieder'; end if;
  update public.events set organizer_id = auth.uid() where id = p_event and organizer_id is null;
  if not found then raise exception 'Der Anlass hat schon einen Organisator'; end if;
  insert into public.rsvps (event_id, member_id, status) values (p_event, auth.uid(), 'in')
  on conflict (event_id, member_id) do update set status = 'in', updated_at = now();
end $$;

create table if not exists public.magnums (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  wine       text not null check (length(wine) between 1 and 80),
  brought_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.magnums enable row level security;

create table if not exists public.magnum_guests (
  id         uuid primary key default gen_random_uuid(),
  magnum_id  uuid not null references public.magnums(id) on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  added_by   uuid default auth.uid() references public.profiles(id) on delete set null,
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

-- ───────────── Heimweg / Fahrservice ─────────────
create table if not exists public.rides (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  driver_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  direction  text not null default '' check (length(direction) <= 60),
  seats      int  not null default 3 check (seats between 1 and 8),
  created_at timestamptz not null default now(),
  unique (event_id, driver_id)
);
alter table public.rides enable row level security;

create table if not exists public.ride_passengers (
  ride_id        uuid not null references public.rides(id) on delete cascade,
  passenger_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
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
  if auth.uid() is null then return new; end if;
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
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.trips enable row level security;

-- Keine Reisen in der Vergangenheit erfinden. Fremde Reisen: nur OK und Kassier, den Rest ändert
-- wer sie erfasst hat. Vergangenes trägt der Admin nach.
create or replace function public.check_trip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if (tg_op = 'INSERT' or new.starts_on is distinct from old.starts_on) and new.starts_on < public.heute() then
    raise exception 'Eine Reise kann nicht in der Vergangenheit liegen';
  end if;
  if tg_op = 'UPDATE' and old.created_by is distinct from auth.uid()
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
  member_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (trip_id, member_id)
);
alter table public.trip_participants enable row level security;

-- Mitreisen bis und mit Starttag und nur, solange Plätze frei sind. Die Sperre lässt parallele Anmeldungen warten.
create or replace function public.check_trip_participant() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start date; v_seats int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  select starts_on, seats into v_start, v_seats from public.trips where id = new.trip_id for update;
  if v_start < public.heute() then raise exception 'Die Reise hat schon begonnen'; end if;
  if (select count(*) from public.trip_participants where trip_id = new.trip_id) >= v_seats then
    raise exception 'Die Reise ist ausgebucht';
  end if;
  return new;
end $$;
drop trigger if exists trip_participant_check on public.trip_participants;
create trigger trip_participant_check before insert on public.trip_participants
  for each row execute function public.check_trip_participant();

create table if not exists public.trip_photos (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  path        text not null,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.trip_photos enable row level security;

-- ───────────── Prost-Wand ─────────────
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid default auth.uid() references public.profiles(id) on delete set null,
  text       text not null check (length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.posts enable row level security;

create table if not exists public.post_prosts (
  post_id   uuid not null references public.posts(id) on delete cascade,
  member_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (post_id, member_id)
);
alter table public.post_prosts enable row level security;

-- ───────────── Abstimmungen: Sacceri-Auszeichnung und Spitznamen ─────────────
-- Zweidrittelmehrheit der Stimmberechtigten, Android-Stimmen zählen doppelt.
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

-- Stimmberechtigt: Sacceri → die Mitreisenden beim Antrag; Spitzname → alle ausser der Person selbst
create or replace function public.eligible_voters(p_proposal uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select unnest(p.voters) from public.proposals p
   where p.id = p_proposal and p.kind = 'sacceri'
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

  select coalesce(sum(public.vote_weight(v)), 0) into v_total from public.eligible_voters(p.id) v;
  select coalesce(sum(case when b.vote then public.vote_weight(b.voter_id) else 0 end), 0),
         coalesce(sum(case when not b.vote then public.vote_weight(b.voter_id) else 0 end), 0)
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
  if p_target = auth.uid() then raise exception 'Du kannst dich nicht selbst auszeichnen'; end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip and member_id = p_target) then
    raise exception 'Nur Mitreisende können ausgezeichnet werden';
  end if;
  if (select sacceri_id from public.trips where id = p_trip) is not null then
    raise exception 'Diese Reise hat schon einen Sacceri';
  end if;
  insert into public.proposals (kind, target_id, trip_id, proposed_by, voters)
  values ('sacceri', p_target, p_trip, auth.uid(), array(select member_id from public.trip_participants where trip_id = p_trip))
  returning id into v_id;
  if exists (select 1 from public.trip_participants where trip_id = p_trip and member_id = auth.uid()) then
    insert into public.ballots (proposal_id, voter_id, vote) values (v_id, auth.uid(), true);
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
  if p_target = auth.uid() then raise exception 'Spitznamen werden von anderen vergeben'; end if;
  insert into public.proposals (kind, target_id, value, proposed_by)
  values ('nickname', p_target, left(trim(p_nick), 40), auth.uid()) returning id into v_id;
  insert into public.ballots (proposal_id, voter_id, vote) values (v_id, auth.uid(), true);
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
  if p.proposed_by = auth.uid() or p.target_id = auth.uid() then
    raise exception 'Die zweite Unterstützung muss von jemand anderem kommen';
  end if;
  update public.proposals set seconded_by = auth.uid() where id = p.id;
  insert into public.ballots (proposal_id, voter_id, vote) values (p.id, auth.uid(), true)
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
  if not exists (select 1 from public.eligible_voters(p.id) v where v = auth.uid()) then
    raise exception 'Du bist für diese Abstimmung nicht stimmberechtigt';
  end if;
  insert into public.ballots (proposal_id, voter_id, vote) values (p.id, auth.uid(), p_yes)
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
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.cards enable row level security;

-- ───────────── Getränkefotos (Trinkfestigkeit) ─────────────
create table if not exists public.drinks (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  drunk_on   date not null default current_date,
  kind       text not null check (kind in ('wein', 'bier', 'schnaps', 'magnum', 'wasser')),
  photo_path text,
  created_at timestamptz not null default now()
);
alter table public.drinks enable row level security;

-- ───────────── Phrasenschwein & Spruch des Tages ─────────────
create table if not exists public.phrases (
  id          uuid primary key default gen_random_uuid(),
  speaker_id  uuid not null references public.profiles(id) on delete cascade,
  phrase      text not null check (length(phrase) between 1 and 200),
  fee_chf     numeric(6,2) not null default 2,
  reported_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.phrases enable row level security;

create table if not exists public.sayings (
  id         uuid primary key default gen_random_uuid(),
  text       text not null check (length(text) between 1 and 280),
  author_id  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sayings enable row level security;

create table if not exists public.saying_prosts (
  saying_id uuid not null references public.sayings(id) on delete cascade,
  member_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (saying_id, member_id)
);
alter table public.saying_prosts enable row level security;

-- Zeitpunkt und Busse legt der Server fest, nicht die App
create or replace function public.set_created_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists created_at_set on public.posts;
create trigger created_at_set before insert on public.posts for each row execute function public.set_created_at();
drop trigger if exists created_at_set on public.sayings;
create trigger created_at_set before insert on public.sayings for each row execute function public.set_created_at();
drop trigger if exists created_at_set on public.phrases;
create trigger created_at_set before insert on public.phrases for each row execute function public.set_created_at();

create or replace function public.set_phrase_fee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then select phrase_fee into new.fee_chf from public.settings where id = 1; end if;
  return new;
end $$;
drop trigger if exists phrase_fee_set on public.phrases;
create trigger phrase_fee_set before insert on public.phrases for each row execute function public.set_phrase_fee();

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
revoke all on table public.invites from anonymous, authenticated;
grant select on public.app_status to anonymous;

-- Lesen: alle Mitglieder (Einladungen nie direkt, nur über die Edge Function)
do $$
declare t text;
begin
  foreach t in array array['settings', 'profiles', 'admin_log', 'restaurants', 'restaurant_visits',
    'restaurant_ratings', 'events', 'rsvps', 'magnums', 'magnum_guests', 'rides', 'ride_passengers', 'trips',
    'trip_participants', 'trip_photos', 'proposals', 'ballots', 'posts', 'post_prosts', 'cards', 'drinks',
    'phrases', 'sayings', 'saying_prosts', 'feedback', 'sync_stand']
  loop
    execute format('drop policy if exists "Mitglieder lesen" on public.%I', t);
    execute format('create policy "Mitglieder lesen" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- Persönliche Einträge: anlegen/ändern nur die Person selbst, löschen sie selbst oder der Admin
do $$
declare r record;
begin
  for r in select * from (values
    ('restaurant_ratings', 'member_id'), ('rsvps', 'member_id'), ('trip_participants', 'member_id'),
    ('drinks', 'member_id'), ('saying_prosts', 'member_id'), ('post_prosts', 'member_id'),
    ('ride_passengers', 'passenger_id'), ('rides', 'driver_id')
  ) as x(tbl, col)
  loop
    execute format('drop policy if exists "Eigene anlegen" on public.%I', r.tbl);
    execute format('drop policy if exists "Eigene ändern" on public.%I', r.tbl);
    execute format('drop policy if exists "Eigene löschen" on public.%I', r.tbl);
    execute format('create policy "Eigene anlegen" on public.%I for insert to authenticated with check (public.is_member() and %I = auth.uid())', r.tbl, r.col);
    execute format('create policy "Eigene ändern" on public.%I for update to authenticated using (%I = auth.uid()) with check (%I = auth.uid())', r.tbl, r.col, r.col);
    execute format('create policy "Eigene löschen" on public.%I for delete to authenticated using (%I = auth.uid() or public.is_admin())', r.tbl, r.col);
  end loop;
end $$;

-- Gemeinsame Inhalte: alle Mitglieder legen an, Ersteller oder Admin ändert/löscht
do $$
declare r record;
begin
  for r in select * from (values
    ('restaurants', 'created_by'), ('restaurant_visits', 'created_by'), ('events', 'created_by'),
    ('magnums', 'brought_by'), ('magnum_guests', 'added_by'), ('trip_photos', 'uploaded_by'),
    ('cards', 'created_by'), ('phrases', 'reported_by'), ('sayings', 'author_id'), ('posts', 'author_id')
  ) as x(tbl, col)
  loop
    execute format('drop policy if exists "Mitglieder anlegen" on public.%I', r.tbl);
    execute format('drop policy if exists "Ersteller ändern" on public.%I', r.tbl);
    execute format('drop policy if exists "Ersteller löschen" on public.%I', r.tbl);
    execute format('create policy "Mitglieder anlegen" on public.%I for insert to authenticated with check (public.is_member() and %I = auth.uid())', r.tbl, r.col);
    execute format('create policy "Ersteller ändern" on public.%I for update to authenticated using (%I = auth.uid() or public.is_admin())', r.tbl, r.col);
    execute format('create policy "Ersteller löschen" on public.%I for delete to authenticated using (%I = auth.uid() or public.is_admin())', r.tbl, r.col);
  end loop;
end $$;

-- Reisen: alle Mitglieder legen an und tragen OK/Kassier ein (Rest siehe check_trip). Der Sacceri kommt nur per Abstimmung.
drop policy if exists "Reisen anlegen" on public.trips;
drop policy if exists "Reisen ändern" on public.trips;
drop policy if exists "Reisen löschen" on public.trips;
create policy "Reisen anlegen" on public.trips for insert to authenticated
  with check (public.is_member() and created_by = auth.uid() and sacceri_id is null);
create policy "Reisen ändern" on public.trips for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy "Reisen löschen" on public.trips for delete to authenticated using (created_by = auth.uid() or public.is_admin());
revoke update on public.trips from authenticated;
grant update (title, starts_on, ends_on, program, seats, color, ok_id, kassier_id) on public.trips to authenticated;

-- Profil: nur eigene, harmlose Felder. Gerät, Spitzname, Funktion und Admin nur über Funktionen.
drop policy if exists "Eigenes Profil ändern" on public.profiles;
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, fav_wine, specialty) on public.profiles to authenticated;

-- Anlässe: Organisator nur über claim_organizer (beim Anlegen siehe check_event)
revoke update on public.events from authenticated;
grant update (title, starts_at, location) on public.events to authenticated;

-- Anmeldungen: "redeemed" setzt nur die Kasse. Der Schlüssel muss in der Liste stehen, weil ein Upsert
-- über die API alle gesendeten Spalten aktualisiert (check_rsvp lässt ihn nicht ändern).
revoke insert, update on public.rsvps from authenticated;
grant insert (event_id, member_id, status, updated_at) on public.rsvps to authenticated;
grant update (event_id, member_id, status, updated_at) on public.rsvps to authenticated;

-- Fahrten bewerten: Passagiere ändern nur die Bewertung, nicht die Fahrt
revoke update on public.ride_passengers from authenticated;
grant update (stars_safe, stars_punctual, stars_mood, points_given, rated_at) on public.ride_passengers to authenticated;

-- Beiträge: nur der Text ist nachträglich änderbar, Zeitpunkt und Busse nicht
revoke update on public.posts, public.sayings, public.phrases from authenticated;
grant update (text) on public.posts, public.sayings to authenticated;
grant update (phrase) on public.phrases to authenticated;

-- ═════════════ Funktionsrechte ═════════════
-- In Postgres darf standardmässig jeder (PUBLIC) Funktionen ausführen – deshalb überall explizit entziehen.
alter default privileges in schema public revoke execute on functions from public;
revoke execute on function public.is_member() from public, anonymous;
revoke execute on function public.is_admin() from public, anonymous;
revoke execute on function public.vote_weight(uuid) from public, anonymous;
revoke execute on function public.me() from public, anonymous;
revoke execute on function public.admin_set_device(uuid, text) from public, anonymous;
revoke execute on function public.admin_set_role(uuid, text) from public, anonymous;
revoke execute on function public.claim_organizer(uuid) from public, anonymous;
revoke execute on function public.open_magnum_kasse() from public, anonymous;
revoke execute on function public.eligible_voters(uuid) from public, anonymous;
revoke execute on function public.resolve_proposal(uuid) from public, anonymous, authenticated;
revoke execute on function public.propose_sacceri(uuid, uuid) from public, anonymous;
revoke execute on function public.propose_nickname(uuid, text) from public, anonymous;
revoke execute on function public.second_proposal(uuid) from public, anonymous;
revoke execute on function public.cast_ballot(uuid, boolean) from public, anonymous;
revoke execute on function public.handle_new_user() from public, anonymous, authenticated;
revoke execute on function public.gate_new_user() from public, anonymous, authenticated;
revoke execute on function public.sync_bump() from public, anonymous, authenticated;
revoke execute on function public.check_ride_passenger() from public, anonymous, authenticated;
revoke execute on function public.heute() from public, anonymous, authenticated;
revoke execute on function public.check_club_size() from public, anonymous, authenticated;
revoke execute on function public.check_event() from public, anonymous, authenticated;
revoke execute on function public.check_rsvp() from public, anonymous, authenticated;
revoke execute on function public.check_trip() from public, anonymous, authenticated;
revoke execute on function public.check_trip_participant() from public, anonymous, authenticated;
revoke execute on function public.set_created_at() from public, anonymous, authenticated;
revoke execute on function public.set_phrase_fee() from public, anonymous, authenticated;
grant execute on function public.is_member(), public.is_admin(), public.vote_weight(uuid), public.me(),
  public.admin_set_device(uuid, text), public.admin_set_role(uuid, text), public.claim_organizer(uuid),
  public.open_magnum_kasse(), public.eligible_voters(uuid), public.propose_sacceri(uuid, uuid),
  public.propose_nickname(uuid, text), public.second_proposal(uuid), public.cast_ballot(uuid, boolean)
  to authenticated;

-- ═════════════ Live-Sync: Änderungen melden ═════════════
do $$
declare t text;
begin
  foreach t in array array['profiles', 'events', 'rsvps', 'magnums', 'magnum_guests', 'rides', 'ride_passengers',
    'trips', 'trip_participants', 'trip_photos', 'proposals', 'ballots', 'posts', 'post_prosts', 'cards', 'drinks',
    'phrases', 'sayings', 'saying_prosts', 'restaurants', 'restaurant_visits', 'restaurant_ratings', 'feedback', 'admin_log']
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
  where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('backups', 'schema_migrations', 'app_status', 'sync_stand');
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

-- Die tägliche Sicherung startet ein Function Trigger (neon.ts): pg_cron läuft nicht, solange die Datenbank schläft.

-- Datenbank-Tests der Club-Regeln gegen ein echtes Postgres (siehe scripts/db-test.sh).
-- Jeder Fehler bricht mit einer Meldung ab. Am Ende steht "ALLE DB-TESTS GRÜN".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Testkonten: A Admin (iPhone), B Android, C iPhone, D iPhone, X Nicht-Mitglied
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test', '{"display_name":"Anna","device":"iphone"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test', '{"display_name":"Beat","device":"android"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test', '{"display_name":"Chris"}'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test', '{"display_name":"Dani","device":"iphone"}');
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';

-- Hilfsfunktion: als Person X handeln
create or replace function pg_temp.als(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', case p
    when 'A' then '00000000-0000-0000-0000-00000000000a' when 'B' then '00000000-0000-0000-0000-00000000000b'
    when 'C' then '00000000-0000-0000-0000-00000000000c' when 'D' then '00000000-0000-0000-0000-00000000000d'
    when 'X' then '00000000-0000-0000-0000-0000000000ff' else '' end, false);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FEHLER: %', msg; end if; raise notice 'ok – %', msg; end $$;
set client_min_messages = notice;

-- 1) Konten aus der Einladung: Profil mit Name und Gerät
select pg_temp.check((select count(*) from public.profiles) = 4, 'Vier Profile angelegt');
select pg_temp.check((select device from public.profiles where display_name = 'Beat') = 'android', 'Gerät Android aus der Einladung übernommen');
select pg_temp.check((select device from public.profiles where display_name = 'Chris') = 'iphone', 'Ohne Angabe gilt iPhone');

-- 2) Ohne Login: keine Funktion ausführbar, jede Tabelle mit RLS
select pg_temp.check((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'EXECUTE')) = 0,
  'Keine Funktion ohne Login ausführbar');
select pg_temp.check((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'Alle Tabellen mit Row Level Security');

-- 3) Testdaten als Mitglieder anlegen
set role authenticated;
select pg_temp.als('A');
insert into public.trips (id, title, starts_on) values ('10000000-0000-0000-0000-000000000001', 'Wallis', '2027-05-01');
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-000000000001', 'Herbst-Stamm', '2026-11-14 19:00+01');
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000001');
select pg_temp.als('B'); insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000001');
select pg_temp.als('C'); insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000001');
select pg_temp.als('D'); insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000001');

-- 4) Nicht-Mitglied sieht nichts und kann nichts anlegen
select pg_temp.als('X');
select pg_temp.check((select count(*) from public.profiles) = 0, 'Nicht-Mitglied sieht keine Profile');
select pg_temp.check((select count(*) from public.trips) = 0, 'Nicht-Mitglied sieht keine Reisen');
do $$ begin
  insert into public.events (title, starts_at) values ('Fremd', now());
  raise exception 'FEHLER: Nicht-Mitglied konnte einen Anlass anlegen';
exception when insufficient_privilege then raise notice 'ok – Nicht-Mitglied kann nichts anlegen'; end $$;

-- 5) Eigenes Gerät, Spitzname und Admin-Status sind nicht selbst änderbar
select pg_temp.als('C');
do $$ begin
  update public.profiles set device = 'android' where id = auth.uid();
  raise exception 'FEHLER: Mitglied konnte sein Gerät selbst ändern';
exception when insufficient_privilege then raise notice 'ok – Gerät nicht selbst änderbar'; end $$;
do $$ begin
  update public.profiles set is_admin = true where id = auth.uid();
  raise exception 'FEHLER: Mitglied konnte sich selbst zum Admin machen';
exception when insufficient_privilege then raise notice 'ok – Admin-Status nicht selbst setzbar'; end $$;
update public.profiles set fav_wine = 'Cornalin' where id = auth.uid();
select pg_temp.check((select fav_wine from public.profiles where id = auth.uid()) = 'Cornalin', 'Lieblingswein selbst änderbar');
do $$ begin
  update public.trips set sacceri_id = auth.uid();
  raise exception 'FEHLER: Sacceri ohne Abstimmung gesetzt';
exception when insufficient_privilege then raise notice 'ok – Sacceri nur per Abstimmung'; end $$;
update public.trips set kassier_id = auth.uid() where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select kassier_id from public.trips) = '00000000-0000-0000-0000-00000000000c', 'Kassier von Mitglied eingetragen');

-- 6) Nur der Admin passt den Gerätetyp an – mit Protokoll
do $$ begin
  perform public.admin_set_device('00000000-0000-0000-0000-00000000000d', 'android');
  raise exception 'FEHLER: Nicht-Admin konnte Gerät ändern';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Nicht-Admin darf Gerät nicht ändern';
end $$;
select pg_temp.als('A');
select public.admin_set_device('00000000-0000-0000-0000-00000000000d', 'android');
select pg_temp.check((select device from public.profiles where display_name = 'Dani') = 'android', 'Admin setzt Gerät auf Android');
select pg_temp.check((select count(*) from public.admin_log) = 1, 'Änderung im Admin-Protokoll');
select public.admin_set_device('00000000-0000-0000-0000-00000000000d', 'iphone');

-- 7) Sacceri: Antrag + ⅔ der Anwesenden, Android zählt doppelt
--    Gewichte: A 1, B 2 (Android), C 1, D 1 → total 5, nötig 4
select pg_temp.als('A');
select public.propose_sacceri('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select status from public.proposals where kind = 'sacceri') = 'open', 'Antrag offen nach Ja des Antragstellers (1 von 4)');
select pg_temp.als('B');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'sacceri'), true) = 'open', 'Android-Ja zählt 2 → 3 von 4, noch offen');
select pg_temp.als('D');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'sacceri'), true) = 'passed', '4 von 4 → Auszeichnung verliehen');
select pg_temp.check((select sacceri_id from public.trips) = '00000000-0000-0000-0000-00000000000c', 'Sacceri bei der Reise eingetragen');
select pg_temp.check((select count(*) from public.posts where text like '%Sacceri%') = 1, 'Meldung auf der Prost-Wand');
do $$ begin
  perform public.propose_sacceri('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b');
  raise exception 'FEHLER: zweiter Sacceri möglich';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – pro Reise nur ein Sacceri';
end $$;

-- 8) Spitzname: Vorschlag + zweite Unterstützung + ⅔ (ohne die Person selbst)
--    Für Dani stimmen A 1, B 2, C 1 → total 4, nötig 3
select pg_temp.als('A');
select public.propose_nickname('00000000-0000-0000-0000-00000000000d', 'Navi');
select pg_temp.check((select nickname from public.profiles where display_name = 'Dani') is null, 'Ohne zweite Unterstützung kein Spitzname');
do $$ begin
  perform public.cast_ballot((select id from public.proposals where kind = 'nickname'), true);
  raise exception 'FEHLER: Abstimmung vor der Unterstützung möglich';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – erst Unterstützung, dann Abstimmung';
end $$;
do $$ begin
  perform public.second_proposal((select id from public.proposals where kind = 'nickname'));
  raise exception 'FEHLER: Antragsteller konnte sich selbst unterstützen';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Antragsteller kann nicht selbst unterstützen';
end $$;
select pg_temp.als('D');
do $$ begin
  perform public.second_proposal((select id from public.proposals where kind = 'nickname'));
  raise exception 'FEHLER: Person konnte ihren eigenen Spitznamen unterstützen';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Person selbst kann nicht unterstützen';
end $$;
select pg_temp.als('B');
select pg_temp.check(public.second_proposal((select id from public.proposals where kind = 'nickname')) = 'passed',
  'Unterstützung durch Android (1 + 2 = 3 von 3) → bestätigt');
select pg_temp.check((select nickname from public.profiles where display_name = 'Dani') = 'Navi', 'Spitzname gesetzt');

-- Abgelehnt: Für Chris stimmen A 1, B 2, D 1 → total 4, nötig 3; Nein von B (2) macht 3 unmöglich
select pg_temp.als('A');
select public.propose_nickname('00000000-0000-0000-0000-00000000000c', 'Chrigu');
select pg_temp.als('D');
select pg_temp.check(public.second_proposal((select id from public.proposals where kind = 'nickname' and status = 'open')) = 'open', '2 von 3 → offen');
select pg_temp.als('B');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'nickname' and status = 'open'), false) = 'rejected', 'Android-Nein → abgelehnt');

-- 9) Organisator: nur einmal, und man ist dann angemeldet
select pg_temp.als('C');
select public.claim_organizer('20000000-0000-0000-0000-000000000001');
select pg_temp.check((select status from public.rsvps where member_id = auth.uid()) = 'in', 'Organisator ist angemeldet');
select pg_temp.als('D');
do $$ begin
  perform public.claim_organizer('20000000-0000-0000-0000-000000000001');
  raise exception 'FEHLER: zweiter Organisator möglich';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – nur ein Organisator';
end $$;

-- 10) Virtuell dabei + Magnum-Kasse (nur Admin öffnet)
insert into public.rsvps (event_id, status) values ('20000000-0000-0000-0000-000000000001', 'virtual');
do $$ begin
  perform public.open_magnum_kasse();
  raise exception 'FEHLER: Nicht-Admin öffnete die Kasse';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – nur Admin öffnet die Kasse';
end $$;
select pg_temp.als('A');
select pg_temp.check(public.open_magnum_kasse() = 1, 'Kasse geöffnet: 1 Magnum');

-- 11) Gasttrinker pro Magnum
select pg_temp.als('B');
insert into public.magnums (id, event_id, wine) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Cornalin 2019');
insert into public.magnum_guests (magnum_id, name) values ('30000000-0000-0000-0000-000000000001', 'Gast Peter');
select pg_temp.check((select count(*) from public.magnum_guests) = 1, 'Gasttrinker an der Magnum erfasst');

-- 12) Fahrservice: nicht bei sich selbst mitfahren, Punkte nur 10/20/30/50
select pg_temp.als('D');
insert into public.rides (id, event_id, direction, seats) values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Wil', 1);
do $$ begin
  insert into public.ride_passengers (ride_id) values ('40000000-0000-0000-0000-000000000001');
  raise exception 'FEHLER: Fahrer fährt bei sich mit';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – nicht bei sich selbst mitfahren';
end $$;
select pg_temp.als('C');
insert into public.ride_passengers (ride_id) values ('40000000-0000-0000-0000-000000000001');
update public.ride_passengers set stars_safe = 5, stars_punctual = 4, stars_mood = 5, points_given = 30, rated_at = now()
 where passenger_id = auth.uid();
select pg_temp.check((select points_given from public.ride_passengers) = 30, 'Mitfahrer verteilt Punkte');
select pg_temp.als('B');
do $$ begin
  insert into public.ride_passengers (ride_id) values ('40000000-0000-0000-0000-000000000001');
  raise exception 'FEHLER: volles Auto nimmt jemanden mit';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – volles Auto';
end $$;

-- 13) Fotos nur in den eigenen Ordner
select pg_temp.als('C');
insert into storage.objects (bucket_id, name) values ('photos', 'drinks/00000000-0000-0000-0000-00000000000c/a.jpg');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('photos', 'drinks/00000000-0000-0000-0000-00000000000b/x.jpg');
  raise exception 'FEHLER: Foto in fremden Ordner hochgeladen';
exception when insufficient_privilege then raise notice 'ok – Fotos nur in den eigenen Ordner'; end $$;

-- 14) Datensicherung: für Mitglieder unerreichbar, Wiederherstellen bringt alles zurück
select pg_temp.als('A');
do $$ begin
  perform public.snapshot_club('Test');
  raise exception 'FEHLER: Admin legt über die App eine Sicherung an';
exception when insufficient_privilege then raise notice 'ok – Sicherung nur serverseitig'; end $$;
do $$ begin
  perform public.restore_club(1);
  raise exception 'FEHLER: Admin stellt über die App wieder her';
exception when insufficient_privilege then raise notice 'ok – Wiederherstellen nur serverseitig'; end $$;
reset role;

do $$
declare hid bigint; profile int; anlaesse int; stimmen int; n int;
begin
  select count(*) into profile from public.profiles;
  select count(*) into anlaesse from public.events;
  select count(*) into stimmen from public.ballots;
  if anlaesse = 0 or stimmen = 0 then raise exception 'FEHLER: Test braucht Anlässe und Stimmen'; end if;
  hid := public.snapshot_club('Test');
  delete from public.events; delete from public.proposals;
  update public.settings set max_members = 99;
  perform public.restore_club(hid);
  select count(*) into n from public.events;
  if n <> anlaesse then raise exception 'FEHLER: Anlässe nicht wiederhergestellt'; end if;
  select count(*) into n from public.ballots;
  if n <> stimmen then raise exception 'FEHLER: Stimmen nicht wiederhergestellt'; end if;
  select count(*) into n from public.profiles;
  if n <> profile then raise exception 'FEHLER: Profile nicht wiederhergestellt'; end if;
  if (select max_members from public.settings) <> 12 then raise exception 'FEHLER: Einstellungen nicht wiederhergestellt'; end if;
  if not exists (select 1 from public.backups where reason = 'vor Wiederherstellung') then
    raise exception 'FEHLER: Stand vor dem Wiederherstellen nicht gesichert';
  end if;
  raise notice 'ok – Sicherung und Wiederherstellung';
end $$;
do $$
declare i int;
begin
  for i in 1..35 loop perform public.snapshot_club('vor Release v' || i); end loop;
  if (select count(*) from public.backups where reason like 'vor Release%') <> 30 then
    raise exception 'FEHLER: Es bleiben nicht die letzten 30 Release-Sicherungen';
  end if;
  raise notice 'ok – die letzten 30 Release-Sicherungen bleiben';
end $$;

select 'ALLE DB-TESTS GRÜN' as ergebnis;

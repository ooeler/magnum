-- Datenbank-Tests der Club-Regeln gegen ein echtes Postgres (siehe scripts/db-test.sh).
-- Jeder Fehler bricht mit einer Meldung ab. Am Ende steht "ALLE DB-TESTS GRÜN".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Testkonten: A Admin (iPhone), B Android, C iPhone, D iPhone, X Nicht-Mitglied
insert into public.invites (token_hash, expires_at, used_at, email, name, device) values
  ('h-a', now() + interval '1 day', now(), 'a@test', 'Anna', 'iphone'),
  ('h-b', now() + interval '1 day', now(), 'b@test', 'Beat', 'android'),
  ('h-c', now() + interval '1 day', now(), 'c@test', 'Chris', null),
  ('h-d', now() + interval '1 day', now(), 'd@test', 'Dani', 'iphone');
insert into neon_auth."user" (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'), ('00000000-0000-0000-0000-00000000000b', 'b@test'), ('00000000-0000-0000-0000-00000000000c', 'c@test'), ('00000000-0000-0000-0000-00000000000d', 'd@test');
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';

-- Hilfsfunktion: als Person X handeln
create or replace function pg_temp.als(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case p
    when 'A' then '{"sub":"00000000-0000-0000-0000-00000000000a"}' when 'B' then '{"sub":"00000000-0000-0000-0000-00000000000b"}'
    when 'C' then '{"sub":"00000000-0000-0000-0000-00000000000c"}' when 'D' then '{"sub":"00000000-0000-0000-0000-00000000000d"}'
    when 'X' then '{"sub":"00000000-0000-0000-0000-0000000000ff"}' else '' end, false);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FEHLER: %', msg; end if; raise notice 'ok – %', msg; end $$;
set client_min_messages = notice;

-- 1) Konten aus der Einladung: Profil mit Name und Gerät
select pg_temp.check((select count(*) from public.profiles) = 4, 'Vier Profile angelegt');
select pg_temp.check((select device from public.profiles where display_name = 'Beat') = 'android', 'Gerät Android aus der Einladung übernommen');
select pg_temp.check((select device from public.profiles where display_name = 'Chris') = 'iphone', 'Ohne Angabe gilt iPhone');
do $$ begin
  insert into neon_auth."user" (email) values ('fremd@test');
  raise exception 'FEHLER: Konto ohne Einladung angelegt';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Konto nur mit Einladung';
end $$;
select pg_temp.check((select count(*) from neon_auth."user") = 4, 'Freie Registrierung hinterlässt kein Konto');
do $$ begin
  update public.invites set used_at = now() - interval '6 minutes' where token_hash = 'h-a';
  insert into public.invites (token_hash, expires_at, used_at, email) values ('h-alt', now(), now() - interval '6 minutes', 'alt@test');
  insert into neon_auth."user" (email) values ('alt@test');
  raise exception 'FEHLER: abgelaufene Reservation angenommen';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Reservation läuft nach 5 Minuten ab';
end $$;
select pg_temp.check((select count(*) from public.invites where used_by is not null) = 4, 'Einladungen sind eingelöst');

-- 2) Ohne Login: keine Funktion ausführbar, jede Tabelle mit RLS
select pg_temp.check((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anonymous', p.oid, 'EXECUTE')) = 0,
  'Keine Funktion ohne Login ausführbar');
select pg_temp.check((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'Alle Tabellen mit Row Level Security');

-- 3) Testdaten als Mitglieder anlegen
set role authenticated;
select pg_temp.als('A');
insert into public.trips (id, title, starts_on) values ('10000000-0000-0000-0000-000000000001', 'Wallis', current_date + 200);
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-000000000001', 'Herbst-Stamm', now() + interval '14 days');
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
  update public.profiles set device = 'android' where id = public.uid();
  raise exception 'FEHLER: Mitglied konnte sein Gerät selbst ändern';
exception when insufficient_privilege then raise notice 'ok – Gerät nicht selbst änderbar'; end $$;
do $$ begin
  update public.profiles set is_admin = true where id = public.uid();
  raise exception 'FEHLER: Mitglied konnte sich selbst zum Admin machen';
exception when insufficient_privilege then raise notice 'ok – Admin-Status nicht selbst setzbar'; end $$;
update public.profiles set fav_wine = 'Cornalin' where id = public.uid();
select pg_temp.check((select fav_wine from public.profiles where id = public.uid()) = 'Cornalin', 'Lieblingswein selbst änderbar');
do $$ begin
  update public.trips set sacceri_id = public.uid();
  raise exception 'FEHLER: Sacceri ohne Abstimmung gesetzt';
exception when insufficient_privilege then raise notice 'ok – Sacceri nur per Abstimmung'; end $$;
update public.trips set kassier_id = public.uid() where id = '10000000-0000-0000-0000-000000000001';
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

-- 7) Sacceri: Antrag + ⅔ der übrigen Mitreisenden, jede Stimme zählt gleich
--    A, B, C, D; C ist vorgeschlagen und stimmt nicht mit → A, B, D: total 3, nötig 2
select pg_temp.als('A');
select public.propose_sacceri('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select status from public.proposals where kind = 'sacceri') = 'open', 'Antrag offen nach Ja des Antragstellers (1 von 2)');
select pg_temp.check((select count(*) from public.eligible_voters((select id from public.proposals where kind = 'sacceri'))) = 3, 'Stimmberechtigt sind 3, ohne die vorgeschlagene Person');
select pg_temp.als('C');
do $$ begin
  perform public.cast_ballot((select id from public.proposals where kind = 'sacceri'), true);
  raise exception 'FEHLER: vorgeschlagene Person stimmte über sich selbst ab';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – keine Stimme über sich selbst';
end $$;
select pg_temp.als('B');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'sacceri'), false) = 'open', 'Nein zählt einfach → 1 Ja, 1 Nein, noch offen');
select pg_temp.als('D');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'sacceri'), true) = 'passed', '2 von 3 → Auszeichnung verliehen');
select pg_temp.check((select total_weight from public.proposals where kind = 'sacceri') = 3, 'Gezählt wird ohne die vorgeschlagene Person');
select pg_temp.check((select sacceri_id from public.trips) = '00000000-0000-0000-0000-00000000000c', 'Sacceri bei der Reise eingetragen');
select pg_temp.check((select count(*) from public.posts where text like '%Sacceri%') = 1, 'Meldung auf der Prost-Wand');
do $$ begin
  perform public.propose_sacceri('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b');
  raise exception 'FEHLER: zweiter Sacceri möglich';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – pro Reise nur ein Sacceri';
end $$;

-- 8) Spitzname: Vorschlag + zweite Unterstützung + ⅔ (ohne die Person selbst)
--    Für Dani stimmen A, B, C → total 3, nötig 2
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
  'Vorschlag + Unterstützung (2 von 2) → bestätigt');
select pg_temp.check((select nickname from public.profiles where display_name = 'Dani') = 'Navi', 'Spitzname gesetzt');


-- 9) Organisator: jederzeit übernehmbar, und man ist dann angemeldet
select pg_temp.als('C');
select public.claim_organizer('20000000-0000-0000-0000-000000000001');
select pg_temp.check((select status from public.rsvps where member_id = public.uid()) = 'in', 'Organisator ist angemeldet');
select pg_temp.als('D');
do $$ begin
  perform public.claim_organizer('20000000-0000-0000-0000-000000000001');
  raise exception 'FEHLER: belegter Abend still übernommen';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – belegten Abend nicht still übernehmen';
end $$;
select public.claim_organizer('20000000-0000-0000-0000-000000000001', (select organizer_id from public.events where id = '20000000-0000-0000-0000-000000000001'));
select pg_temp.check((select organizer_id from public.events where id = '20000000-0000-0000-0000-000000000001') = public.uid(), 'Künftiger Abend lässt sich übernehmen');
select pg_temp.check((select status from public.rsvps where member_id = public.uid() and event_id = '20000000-0000-0000-0000-000000000001') = 'in', 'Wer übernimmt, ist angemeldet');
do $$ begin
  perform public.claim_organizer('20000000-0000-0000-0000-000000000001');
  raise exception 'FEHLER: eigener Abend nochmals übernommen';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – den eigenen Abend nicht nochmals';
end $$;

-- 9b) Der Organisator ist immer dabei: abmelden erst nach dem Abgeben
do $$ begin
  update public.rsvps set status = 'out' where member_id = public.uid() and event_id = '20000000-0000-0000-0000-000000000001';
  raise exception 'FEHLER: Organisator konnte sich abmelden';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Organisator meldet sich nicht ab';
end $$;
do $$ begin
  delete from public.rsvps where member_id = public.uid() and event_id = '20000000-0000-0000-0000-000000000001';
  raise exception 'FEHLER: Organisator konnte seine Anmeldung löschen';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Organisator löscht seine Anmeldung nicht';
end $$;
select public.set_organizer('20000000-0000-0000-0000-000000000001', null);

-- 10) Virtuell dabei + Magnum-Kasse (nur Admin öffnet)
update public.rsvps set status = 'virtual' where member_id = public.uid();
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
do $$ begin
  update public.ride_passengers set points_given = 30 where passenger_id = public.uid();
  raise exception 'FEHLER: Bewertung vor dem Anlass';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – bewerten erst nach dem Anlass';
end $$;
reset role;
select pg_temp.als('');
update public.events set starts_at = now() - interval '1 minute';
set role authenticated;
select pg_temp.als('C');
update public.ride_passengers set stars_safe = 5, stars_punctual = 4, stars_mood = 5, points_given = 30, rated_at = now()
 where passenger_id = public.uid();
select pg_temp.check((select points_given from public.ride_passengers) = 30, 'Mitfahrer verteilt Punkte');
select pg_temp.als('B');
do $$ begin
  insert into public.ride_passengers (ride_id) values ('40000000-0000-0000-0000-000000000001');
  raise exception 'FEHLER: volles Auto nimmt jemanden mit';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – volles Auto';
end $$;

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
select pg_temp.als('');  -- wie im SQL Editor: ohne Login

do $$
declare hid bigint; profile int; anlaesse int; stimmen int; n int;
begin
  select count(*) into profile from public.profiles;
  select count(*) into anlaesse from public.events;
  select count(*) into stimmen from public.ballots;
  if anlaesse = 0 or stimmen = 0 then raise exception 'FEHLER: Test braucht Anlässe und Stimmen'; end if;
  hid := public.snapshot_club('Test');
  delete from public.events; delete from public.proposals;
  update public.settings set goal_target = 99;
  perform public.restore_club(hid);
  select count(*) into n from public.events;
  if n <> anlaesse then raise exception 'FEHLER: Anlässe nicht wiederhergestellt'; end if;
  select count(*) into n from public.ballots;
  if n <> stimmen then raise exception 'FEHLER: Stimmen nicht wiederhergestellt'; end if;
  select count(*) into n from public.profiles;
  if n <> profile then raise exception 'FEHLER: Profile nicht wiederhergestellt'; end if;
  if (select goal_target from public.settings) = 99 then raise exception 'FEHLER: Einstellungen nicht wiederhergestellt'; end if;
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

-- 15) Fremde Einträge bleiben tabu, auch mit direktem Zugriff an der App vorbei
set role authenticated;
select pg_temp.als('C');
do $$ begin
  insert into public.rsvps (event_id, member_id, status) values ((select id from public.events limit 1), '00000000-0000-0000-0000-00000000000b', 'in');
  raise exception 'FEHLER: Anmeldung für jemand anderen';
exception when insufficient_privilege then raise notice 'ok – niemand meldet andere an'; end $$;
with x as (update public.rsvps set status = 'out' where member_id <> public.uid() returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Fremde Anmeldungen nicht änderbar');
with x as (delete from public.events where created_by <> public.uid() returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Fremde Anlässe nicht löschbar');
with x as (update public.settings set goal_target = 99 returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Einstellungen nicht änderbar');
do $$ begin
  perform 1 from public.invites;
  raise exception 'FEHLER: Einladungen direkt lesbar';
exception when insufficient_privilege then raise notice 'ok – Einladungen nicht direkt lesbar'; end $$;
do $$ begin
  insert into public.proposals (kind, target_id, proposed_by, status) values ('nickname', public.uid(), public.uid(), 'passed');
  raise exception 'FEHLER: Antrag direkt angelegt';
exception when insufficient_privilege then raise notice 'ok – Anträge nur über Funktionen'; end $$;
do $$ begin
  insert into public.ballots (proposal_id, voter_id, vote) values ((select id from public.proposals limit 1), public.uid(), true);
  raise exception 'FEHLER: Stimme direkt abgegeben';
exception when insufficient_privilege then raise notice 'ok – Stimmen nur über Funktionen'; end $$;
do $$ begin
  insert into public.admin_log (admin_id, action) values (public.uid(), 'gefälscht');
  raise exception 'FEHLER: Admin-Protokoll gefälscht';
exception when insufficient_privilege then raise notice 'ok – Admin-Protokoll nicht fälschbar'; end $$;
do $$ begin
  perform public.admin_set_role(public.uid(), 'Präsident');
  raise exception 'FEHLER: Funktion ohne Admin-Recht geändert';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – Funktion ändert nur der Admin';
end $$;
do $$ begin
  perform public.cast_ballot((select id from public.proposals where status = 'passed' limit 1), false);
  raise exception 'FEHLER: Stimme nach Abschluss';
exception when raise_exception then
  if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok – abgeschlossene Abstimmung ist zu';
end $$;
select pg_temp.als('A');
do $$ begin
  perform 1 from public.backups;
  raise exception 'FEHLER: Sicherungen für den Admin lesbar';
exception when insufficient_privilege then raise notice 'ok – Sicherungen auch für den Admin nicht lesbar'; end $$;
select pg_temp.als('X');
select pg_temp.check((select count(*) from public.profiles) = 0, 'Nicht-Mitglied sieht keine Mitglieder');
reset role;

-- 16) Fristen und Spielregeln gelten auch an der App vorbei
create or replace function pg_temp.verboten(p_sql text, msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when raise_exception or insufficient_privilege then
    raise notice 'ok – %', msg; return;
  end;
  raise exception 'FEHLER: %', msg;
end $$;
set role authenticated;
select pg_temp.als('C');
select pg_temp.verboten($q$insert into public.events (title, starts_at) values ('Erfunden', now() - interval '3 days')$q$, 'Keine Anlässe in der Vergangenheit');
select pg_temp.verboten($q$insert into public.events (title, starts_at, organizer_id) values ('Erfunden', now() + interval '3 days', public.uid())$q$, 'Organisator nicht beim Anlegen');
select pg_temp.verboten($q$insert into public.trips (title, starts_on) values ('Erfunden', current_date - 3)$q$, 'Keine Reisen in der Vergangenheit');
select pg_temp.verboten($q$update public.trips set title = 'Fremd' where id = '10000000-0000-0000-0000-000000000001'$q$, 'Fremde Reise nicht änderbar');
select pg_temp.verboten($q$insert into public.rsvps (event_id, status, redeemed) values ('20000000-0000-0000-0000-000000000001', 'virtual', true)$q$, 'redeemed nicht beim Anmelden setzbar');
select pg_temp.als('D');
select pg_temp.verboten($q$update public.rsvps set redeemed = true where member_id = public.uid()$q$, 'redeemed nicht änderbar');
insert into public.rsvps (event_id, member_id, status) values ('20000000-0000-0000-0000-000000000001', public.uid(), 'in')
on conflict (event_id, member_id) do update set event_id = excluded.event_id, member_id = excluded.member_id, status = excluded.status;
select pg_temp.check((select status from public.rsvps where member_id = public.uid()) = 'in', 'Upsert wie von der App funktioniert');

select pg_temp.als('C');
insert into public.trips (id, title, starts_on, seats) values ('10000000-0000-0000-0000-000000000002', 'Klein', current_date + 30, 2);
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000002');
update public.trips set program = 'Eigene Reise' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.als('B');
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000002');
update public.trips set ok_id = public.uid() where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select ok_id from public.trips where id = '10000000-0000-0000-0000-000000000002') = public.uid(), 'OK auf fremder Reise eintragen geht');

-- Stimmberechtigt ist, wer beim Antrag mitreist: Beitritt danach zählt nicht.
-- A reist nicht mit und stellt den Antrag für B; stimmberechtigt ist nur C.
select pg_temp.als('A');
select public.propose_sacceri('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b');
reset role;
select pg_temp.als('');
update public.trips set seats = 5 where id = '10000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.als('D');
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000002');
select pg_temp.verboten($q$select public.cast_ballot((select id from public.proposals where status = 'open' and kind = 'sacceri'), true)$q$, 'Beitritt nach dem Antrag gibt keine Stimme');
-- Abgelehnt: nur C stimmt, nötig 1. Ein Nein macht die Mehrheit unmöglich
select pg_temp.als('C');
select pg_temp.check(public.cast_ballot((select id from public.proposals where status = 'open' and kind = 'sacceri'), false) = 'rejected', 'Nein macht die Mehrheit unmöglich → abgelehnt');

-- Vorbei ist vorbei: keine Anmeldung, keine Abmeldung, keine Mitfahrt, kein Mitreisen
select pg_temp.als('A');
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-000000000002', 'Nachgetragen', now() - interval '3 days');
select pg_temp.check((select count(*) from public.events where id = '20000000-0000-0000-0000-000000000002') = 1, 'Admin trägt Vergangenes nach');
reset role;
select pg_temp.als('');
update public.events set starts_at = now() - interval '3 days';
update public.trips set starts_on = current_date - 3 where id = '10000000-0000-0000-0000-000000000002';
update public.trips set seats = 12 where id = '10000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.als('B');
select pg_temp.verboten($q$insert into public.rsvps (event_id, status) values ('20000000-0000-0000-0000-000000000001', 'in')$q$, 'Keine Anmeldung nach dem Anlass');
select pg_temp.verboten($q$insert into public.ride_passengers (ride_id) values ('40000000-0000-0000-0000-000000000001')$q$, 'Keine Mitfahrt nach dem Anlass');
select pg_temp.als('A');
insert into public.rsvps (event_id, status) values ('20000000-0000-0000-0000-000000000002', 'in');
select pg_temp.check((select count(*) from public.rsvps where event_id = '20000000-0000-0000-0000-000000000002') = 1, 'Admin trägt seine Anwesenheit nach');
delete from public.trip_participants where trip_id = '10000000-0000-0000-0000-000000000002' and member_id = public.uid();
select pg_temp.als('D');
select pg_temp.verboten($q$delete from public.rsvps where member_id = public.uid()$q$, 'Keine Abmeldung nach dem Anlass');
select pg_temp.verboten($q$update public.rsvps set status = 'out' where member_id = public.uid()$q$, 'Status nach dem Anlass fest');
select pg_temp.verboten($q$select public.claim_organizer('20000000-0000-0000-0000-000000000002')$q$, 'Vergangenes nicht organisieren');
select pg_temp.check((select organizer_id from public.events where id = '20000000-0000-0000-0000-000000000002') is null, 'Organisator blieb leer');
delete from public.trip_participants where trip_id = '10000000-0000-0000-0000-000000000002' and member_id = public.uid();
select pg_temp.verboten($q$insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000002')$q$, 'Kein Mitreisen nach dem Start');

-- Server legt den Zeitpunkt fest
select pg_temp.als('C');
insert into public.posts (text, created_at) values ('Zukunft', '2099-01-01');
select pg_temp.check((select created_at < now() + interval '1 minute' from public.posts where text = 'Zukunft'), 'Beitrag bekommt die Serverzeit');
reset role;
select pg_temp.als('');

-- 20) Organisator setzen: Admin, Ersteller oder Organisator, nicht Fremde
set role authenticated;
select pg_temp.als('B');
select pg_temp.verboten($q$select public.set_organizer('20000000-0000-0000-0000-000000000002', public.uid())$q$, 'Fremde setzen keinen Organisator');
select pg_temp.als('A');
select public.set_organizer('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select organizer_id from public.events where id = '20000000-0000-0000-0000-000000000002') = '00000000-0000-0000-0000-00000000000b', 'Admin setzt Organisator auch rückwirkend');
select public.set_organizer('20000000-0000-0000-0000-000000000002', null);
select pg_temp.check((select organizer_id from public.events where id = '20000000-0000-0000-0000-000000000002') is null, 'Organisator entfernen');
reset role;
select pg_temp.als('');

-- 19) Administrator: Mitglied ist Standard, Rolle nur durch Admins, einer bleibt
set role authenticated;
select pg_temp.als('C');
select pg_temp.verboten($q$select public.admin_set_admin(public.uid(), true)$q$, 'Mitglied macht sich nicht zum Admin');
select pg_temp.als('A');
select public.admin_set_admin('00000000-0000-0000-0000-00000000000c', true);
select pg_temp.check((select is_admin from public.profiles where id = '00000000-0000-0000-0000-00000000000c'), 'Admin vergibt die Rolle');
select pg_temp.check((select count(*) from public.admin_log where action = 'Rolle → Administrator') = 1, 'Rolle im Protokoll');
select public.admin_set_admin('00000000-0000-0000-0000-00000000000c', false);
select pg_temp.verboten($q$select public.admin_set_admin(public.uid(), false)$q$, 'Letzter Admin bleibt');
reset role;
select pg_temp.als('');

-- 17) Magnum-Serie: letzter Freitag im Monat, die nächsten drei, gelöschte kommen nicht zurück
select pg_temp.check(public.letzter_freitag('2026-11-10') = '2026-11-27', 'Letzter Freitag im November 2026');
select pg_temp.check(public.letzter_freitag('2026-12-01') = '2026-12-25', 'Letzter Freitag im Dezember 2026');
select pg_temp.check(public.letzter_freitag('2027-01-31') = '2027-01-29', 'Letzter Freitag im Januar 2027');
select pg_temp.check(public.letzter_freitag('2027-05-01') = '2027-05-28', 'Letzter Freitag im Mai 2027');
select pg_temp.check(public.letzter_freitag('2027-07-15') = '2027-07-30', 'Der letzte Freitag kann der 30. sein');
select pg_temp.check(public.magnum_titel('2027-03-26') = 'März-Magnum', 'Name aus dem Datum');
set role authenticated;
select pg_temp.als('C');
select pg_temp.check(public.magnum_termine() = 3, 'Drei Magnum-Abende angelegt');
select pg_temp.check(public.magnum_termine() = 0, 'Zweiter Aufruf legt nichts doppelt an');
select pg_temp.check((select count(*) from public.events where title like '%-Magnum' and extract(dow from (starts_at at time zone 'Europe/Zurich')) = 5 and (starts_at at time zone 'Europe/Zurich')::time = '19:00') = 3, 'Alle am Freitag um 19 Uhr');
with x as (update public.events set title = 'Fremd' where title like '%-Magnum' returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Serie ohne Organisator ändert nur der Admin');
select public.claim_organizer((select id from public.events where title like '%-Magnum' order by starts_at limit 1));
with x as (update public.events set title = 'Grosser Abend', starts_at = starts_at + interval '1 day' where organizer_id = public.uid() and title like '%-Magnum' returning 1)
select pg_temp.check((select count(*) from x) = 1, 'Organisator ändert Name und Datum');
select pg_temp.verboten($q$update public.events set starts_at = now() - interval '9 days' where title = 'Grosser Abend'$q$, 'Datum nicht in die Vergangenheit');
select pg_temp.verboten($q$select public.admin_set_rsvp('20000000-0000-0000-0000-000000000002', public.uid(), 'in')$q$, 'Anwesenheit trägt nur der Admin nach');
select pg_temp.als('A');
select public.admin_set_rsvp('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'in');
select pg_temp.check((select status from public.rsvps where event_id = '20000000-0000-0000-0000-000000000002' and member_id = '00000000-0000-0000-0000-00000000000b') = 'in', 'Admin trägt Anwesenheit nach');
select public.admin_set_rsvp('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', null);
select pg_temp.check((select count(*) from public.rsvps where event_id = '20000000-0000-0000-0000-000000000002' and member_id = '00000000-0000-0000-0000-00000000000b') = 0, 'Admin entfernt Anwesenheit');
delete from public.events where title like '%-Magnum';
select pg_temp.check(public.magnum_termine() = 0, 'Gelöschter Abend kommt nicht zurück');
reset role;
select pg_temp.als('');


insert into public.invites (token_hash, expires_at, used_at, email) select 'h-viel' || i, now() + interval '1 day', now(), 'viel' || i || '@test' from generate_series(1, 15) i;
insert into neon_auth."user" (email) select 'viel' || i || '@test' from generate_series(1, 15) i;
select pg_temp.check((select count(*) from public.profiles) > 15, 'Keine Obergrenze bei den Mitgliedern');

-- 22) Gäste bei Anlass und Reise, keine Obergrenze beim Mitreisen
set role authenticated;
select pg_temp.als('A');
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-000000000008', 'Gästeabend', now() + interval '10 days');
select pg_temp.als('C');
insert into public.gaeste (event_id, name) values ('20000000-0000-0000-0000-000000000008', 'Peter');
select pg_temp.verboten($q$insert into public.gaeste (event_id, name) values ('20000000-0000-0000-0000-000000000001', 'Nachzügler')$q$, 'Gäste bei vergangenen Anlässen nur der Admin');
select pg_temp.verboten($q$insert into public.rides (event_id, direction, seats) values ('20000000-0000-0000-0000-000000000001', 'Wil', 2)$q$, 'Fahrten anbieten nur bis und mit dem Tag nach dem Anlass');
reset role;
select pg_temp.als('');
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-0000000000f1', 'Gestern', (date_trunc('day', now() at time zone 'Europe/Zurich') - interval '1 day' + interval '19 hours') at time zone 'Europe/Zurich');
set role authenticated;
select pg_temp.als('C');
insert into public.rides (event_id, direction, seats) values ('20000000-0000-0000-0000-0000000000f1', 'Wil', 2);
select pg_temp.check((select count(*) from public.rides where event_id = '20000000-0000-0000-0000-0000000000f1') = 1, 'Fahrten anbieten auch am Tag nach dem Anlass');
insert into public.gaeste (trip_id, name) values ('10000000-0000-0000-0000-000000000001', 'Maria');
select pg_temp.check((select count(*) from public.gaeste) = 2, 'Gäste bei Anlass und Reise');
do $$ begin
  insert into public.gaeste (name) values ('Niemand');
  raise exception 'FEHLER: Gast ohne Anlass';
exception when check_violation then raise notice 'ok – Gast gehört zu Anlass oder Reise'; end $$;
select pg_temp.als('D');
with x as (delete from public.gaeste returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Fremde Gäste nicht löschbar');
reset role;
select pg_temp.als('');

-- 21) Personen auf Karten: Ersteller oder Admin, nur diese bekommen Punkte
set role authenticated;
select pg_temp.als('C');
insert into public.cards (id, title, rarity) values ('50000000-0000-0000-0000-000000000001', 'Grosse Nacht', 'magic');
insert into public.card_members (card_id, member_id) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b');
select pg_temp.als('D');
select pg_temp.verboten($q$insert into public.card_members (card_id, member_id) values ('50000000-0000-0000-0000-000000000001', public.uid())$q$, 'Fremde tragen sich nicht ein');
with x as (delete from public.card_members returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Fremde nehmen niemanden von der Karte');
reset role;
select pg_temp.als('');

-- 23) Videokarten: verdeckt, gezogen am Abend, nie die eigene, eine pro Abend
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-000000000003', 'Oktober-Magnum', now() - interval '1 hour');
insert into public.rsvps (event_id, member_id, status) values
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', 'virtual'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'in')
  on conflict (event_id, member_id) do update set status = excluded.status;
set role authenticated;
select pg_temp.als('C');
insert into public.video_karten (id, title, path) values
  ('60000000-0000-0000-0000-000000000001', 'Korken', 'videos/00000000-0000-0000-0000-00000000000c/1.webm'),
  ('60000000-0000-0000-0000-000000000002', 'Tanz', 'videos/00000000-0000-0000-0000-00000000000c/2.mp4');
select pg_temp.als('B');
insert into public.video_karten (id, title, path) values ('60000000-0000-0000-0000-000000000003', 'Eigenes', 'videos/00000000-0000-0000-0000-00000000000b/3.webm');
select pg_temp.verboten($q$insert into public.video_karten (title, path) values ('Fremd', 'videos/00000000-0000-0000-0000-00000000000c/9.webm')$q$, 'Video nur im eigenen Ordner');
select pg_temp.check((select count(*) from public.video_karten) = 1, 'Fremde Videokarten bleiben verdeckt');
select pg_temp.check(public.video_bestand() = 3, 'Bestand zählt alle Videokarten');
select pg_temp.check(public.video_ziehbar() = 2, 'Ziehbar sind nur fremde Karten');
select pg_temp.verboten($q$select public.karte_ziehen('20000000-0000-0000-0000-000000000001')$q$, 'Ziehen erst am Abend selbst');
select pg_temp.verboten($q$insert into public.video_ziehungen (event_id, member_id, karte_id) values ('20000000-0000-0000-0000-000000000003', public.uid(), '60000000-0000-0000-0000-000000000001')$q$, 'Ziehen nur über karte_ziehen');
select pg_temp.check(public.karte_ziehen('20000000-0000-0000-0000-000000000003') in ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002'), 'Virtuell dabei zieht eine fremde Karte');
select pg_temp.check((select count(*) from public.video_karten) = 2, 'Gezogene Karte ist danach sichtbar');
select pg_temp.verboten($q$select public.karte_ziehen('20000000-0000-0000-0000-000000000003')$q$, 'Nur eine Karte pro Abend');
select pg_temp.check(public.video_ziehbar() = 1, 'Gezogene Karte ist nicht mehr ziehbar');
select pg_temp.als('D');
select pg_temp.verboten($q$select public.karte_ziehen('20000000-0000-0000-0000-000000000003')$q$, 'Wer nicht dabei ist, zieht nicht');
select pg_temp.check((select count(*) from public.video_ziehungen) = 1, 'Alle sehen, wer wie viele Karten hat');
select pg_temp.als('C');
with x as (delete from public.video_karten where id in (select karte_id from public.video_ziehungen) returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Gezogene Karte löscht der Ersteller nicht mehr');
with x as (delete from public.video_karten where id not in (select karte_id from public.video_ziehungen) returning 1)
select pg_temp.check((select count(*) from x) = 1, 'Ungezogene eigene Karte löschbar');

-- Sofortige Push-Nachrichten: Trigger legen in die Warteschlange, die App sieht sie nicht
reset role;
delete from public.push_queue;
set role authenticated;
select pg_temp.als('A');
insert into public.events (id, title, starts_at) values ('20000000-0000-0000-0000-000000000009', 'Push-Abend', now() + interval '20 days');
select pg_temp.verboten($q$select * from public.push_queue$q$, 'Warteschlange nicht über die App lesbar');
select pg_temp.als('B');
select public.claim_organizer('20000000-0000-0000-0000-000000000009');
select pg_temp.als('C');
insert into public.rsvps (event_id, status) values ('20000000-0000-0000-0000-000000000009', 'in');
update public.rsvps set status = 'in' where event_id = '20000000-0000-0000-0000-000000000009' and member_id = public.uid();
update public.rsvps set status = 'out' where event_id = '20000000-0000-0000-0000-000000000009' and member_id = public.uid();
select pg_temp.als('D');
select public.claim_organizer('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000b');
reset role;
select pg_temp.als('');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Neuer Anlass: Push-Abend' and an is null and ausser = '00000000-0000-0000-0000-00000000000a') = 1, 'Neuer Anlass: an alle ausser wer ihn erfasst');
select pg_temp.check((select count(*) from public.push_queue where titel like 'Push-Abend: Beat organisiert' and ausser = '00000000-0000-0000-0000-00000000000b') = 1, 'Neuer Organisator: an alle ausser ihn');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Anmeldung: Push-Abend' and an = '00000000-0000-0000-0000-00000000000b' and text like 'Chris ist dabei.%') = 1, 'Anmeldung: an den Organisator, einmal');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Abmeldung: Push-Abend' and an = '00000000-0000-0000-0000-00000000000b') = 1, 'Abmeldung: an den Organisator');
select pg_temp.check((select count(*) from public.push_queue where an = '00000000-0000-0000-0000-00000000000c') = 0, 'Keine Meldung an sich selbst');
select pg_temp.check((select count(*) from public.push_queue where titel like 'Push-Abend: Dani übernimmt' and text like '%von Beat%') = 1, 'Übernahme: an alle, mit dem bisherigen Organisator');
select pg_temp.check((select count(*) from public.push_queue where an = '00000000-0000-0000-0000-00000000000d' or (an = '00000000-0000-0000-0000-00000000000b' and text like 'Beat%')) = 0, 'Organisator bekommt keine Meldung über sich selbst');
select pg_temp.check((select count(*) from public.push_queue) = 5, 'Genau fünf Meldungen');
-- Wer schon dabei ist, hört auch von An- und Abmeldungen: B (Organisator bis eben) und D (Organisator) sind dabei, A meldet sich an
delete from public.push_queue;
set role authenticated;
select pg_temp.als('A');
insert into public.rsvps (event_id, status) values ('20000000-0000-0000-0000-000000000009', 'virtual');
reset role;
select pg_temp.als('');
select pg_temp.check((select array_agg(an order by an)::text from public.push_queue where titel = 'Virtuell dabei: Push-Abend')
  = '{00000000-0000-0000-0000-00000000000b,00000000-0000-0000-0000-00000000000d}', 'An- und Abmeldung: an Organisator und alle, die dabei sind');
delete from public.push_queue;
select public.magnum_termine();
select pg_temp.check((select count(*) from public.push_queue where titel like 'Neuer Anlass%') = 0, 'Automatische Magnum-Serie meldet keinen neuen Anlass');
set role authenticated;
-- Volle Gläser (Likes) für Karten
select pg_temp.als('B');
insert into public.karten_glaeser (karte) select 'video-' || karte_id from public.video_ziehungen where member_id = public.uid();
insert into public.karten_glaeser (karte) values ('video-60000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from public.karten_glaeser) = 2, 'Glas für gezogene und eigene Videokarte');
do $$ begin
  insert into public.karten_glaeser (karte) values ('video-60000000-0000-0000-0000-000000000003');
  raise exception 'FEHLER: zweites Glas für dieselbe Karte';
exception when unique_violation then raise notice 'ok – Pro Karte nur ein Glas';
end $$;
select pg_temp.verboten($q$insert into public.karten_glaeser (karte, member_id) values ('video-60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000c')$q$, 'Kein Glas im Namen anderer');
select pg_temp.verboten($q$insert into public.karten_glaeser (karte) values ('karte-70000000-0000-0000-0000-000000000099')$q$, 'Kein Glas für Karten, die es nicht gibt');
do $$ begin
  insert into public.karten_glaeser (karte) values ('geheim-streak');
  raise exception 'FEHLER: Glas für geheime Karte';
exception when check_violation then raise notice 'ok – Geheime Karten bekommen keine Gläser';
end $$;
select pg_temp.als('D');
select pg_temp.verboten($q$insert into public.karten_glaeser (karte) values ('video-60000000-0000-0000-0000-000000000003')$q$, 'Kein Glas für verdeckte Videokarten');
select pg_temp.check((select count(*) from public.karten_glaeser) = 2, 'Alle sehen die Gläser');
with x as (delete from public.karten_glaeser returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Fremde Gläser nimmt niemand weg');
select pg_temp.als('B');
delete from public.video_karten where id = '60000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from public.karten_glaeser) = 1, 'Gläser gehen mit der gelöschten Karte');
with x as (delete from public.karten_glaeser where member_id = public.uid() returning 1)
select pg_temp.check((select count(*) from x) = 1, 'Eigenes Glas zurücknehmen');
-- Push an wer die Karte hochgeladen hat: für die gezogene fremde Karte einmal, für die eigene nie, nochmals geben meldet nicht nochmals
insert into public.karten_glaeser (karte) select 'video-' || karte_id from public.video_ziehungen where member_id = public.uid();
reset role;
select pg_temp.als('');
select pg_temp.check((select count(*) from public.push_queue q join public.video_karten k on q.an = k.created_by
  where q.titel like '🍷 Volles Glas für «%' and q.text like 'Beat hat deiner Karte ein volles Glas gegeben. Jetzt: 1 volles Glas.') = 1, 'Glas: Push an wer die Karte hochgeladen hat, einmal');
select pg_temp.check((select count(*) from public.push_queue where titel like '🍷%' and an = '00000000-0000-0000-0000-00000000000b') = 0, 'Kein Push für eigene Gläser');
select pg_temp.check(public.glas_menge(9) = '2 Flaschen und 1 volles Glas' and public.glas_menge(4) = '1 Flasche' and public.glas_menge(2) = '2 volle Gläser', 'Menge in Flaschen und Gläsern');
set role authenticated;
select pg_temp.als('B');
reset role;
select pg_temp.als('');

-- Karte der Woche: in der laufenden Woche nur für die 3, für die sie aufgedeckt ist
delete from public.karte_der_woche;
insert into public.cards (id, title, rarity) values ('50000000-0000-0000-0000-000000000077', 'Wochenkarte', 'magic') on conflict do nothing;
insert into public.karte_der_woche (woche, card_id) values
  (date_trunc('week', public.heute()::timestamp)::date, '50000000-0000-0000-0000-000000000077'),
  (date_trunc('week', public.heute()::timestamp)::date - 7, '50000000-0000-0000-0000-000000000077');
insert into public.karte_der_woche_fuer (woche, member_id) select w, m from
  (values (date_trunc('week', public.heute()::timestamp)::date), (date_trunc('week', public.heute()::timestamp)::date - 7)) x(w),
  (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000c'::uuid), ('00000000-0000-0000-0000-00000000000d'::uuid)) y(m);
set role authenticated;
select pg_temp.als('A');
select pg_temp.check((select count(*) from public.karte_der_woche) = 1, 'Nicht dran: nur die vergangene Woche sichtbar');
select pg_temp.check((select count(*) from public.karte_der_woche_fuer) = 6, 'Alle sehen, für wen sie aufgedeckt ist');
select pg_temp.verboten($q$insert into public.karte_der_woche_fuer (woche, member_id) values (date_trunc('week', now())::date, public.uid())$q$, 'Sich selbst nicht dazuschreiben');
select pg_temp.als('C');
select pg_temp.check((select count(*) from public.karte_der_woche) = 2, 'Für die 3: auch die laufende Woche sichtbar');
reset role;
select pg_temp.als('');

-- Reisen: Fotos nur für Mitreisende, «als Karte» für alle, Anzahl für alle; Ämtli-Liste; Abmelden
set role authenticated;
select pg_temp.als('A');
insert into public.trips (id, title, starts_on, seats) values ('10000000-0000-0000-0000-000000000009', 'Fotoreise', current_date + 40, 10);
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000009');
insert into public.trip_photos (id, trip_id, path) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009', 'trips/00000000-0000-0000-0000-00000000000a/1.jpg'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000009', 'trips/00000000-0000-0000-0000-00000000000a/2.jpg');
update public.trip_photos set als_karte = true where id = '80000000-0000-0000-0000-000000000002';
select pg_temp.verboten($q$update public.trip_photos set path = 'x' where id = '80000000-0000-0000-0000-000000000001'$q$, 'Am Foto nur «als Karte» änderbar');
select pg_temp.als('B');
select pg_temp.check((select count(*) from public.trip_photos where trip_id = '10000000-0000-0000-0000-000000000009') = 1, 'Daheimgeblieben: nur das Foto für die Karte sichtbar');
select pg_temp.check((select anzahl from public.reise_fotos() where trip_id = '10000000-0000-0000-0000-000000000009') = 2, 'Daheimgeblieben: Anzahl aller Fotos sichtbar');
select pg_temp.verboten($q$insert into public.trip_photos (trip_id, path) values ('10000000-0000-0000-0000-000000000009', 'trips/00000000-0000-0000-0000-00000000000b/x.jpg')$q$, 'Fotos laden nur Mitreisende hoch');
with x as (update public.trip_photos set als_karte = false returning 1)
select pg_temp.check((select count(*) from x) = 0, 'Fremde Fotos nicht umstellen');
-- Ämtli
insert into public.trip_aemtli (trip_id, member_id, rolle, added_by) values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000c', 'organisator', public.uid());
insert into public.trip_aemtli (trip_id, member_id, rolle, added_by) values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000c', 'kassier', public.uid());
select pg_temp.check((select count(*) from public.trip_aemtli where trip_id = '10000000-0000-0000-0000-000000000009') = 2, 'Ämtli: eine Person mit zwei Rollen');
do $$ begin
  insert into public.trip_aemtli (trip_id, member_id, rolle, added_by) values ('10000000-0000-0000-0000-000000000009', public.uid(), 'chef', public.uid());
  raise exception 'FEHLER: unbekannte Rolle';
exception when check_violation then raise notice 'ok – Nur OK, Organisator, Kassier';
end $$;
select pg_temp.verboten($q$insert into public.trip_aemtli (trip_id, member_id, rolle, added_by) values ('10000000-0000-0000-0000-000000000009', public.uid(), 'ok', '00000000-0000-0000-0000-00000000000c')$q$, 'Ämtli nicht im Namen anderer eintragen');
select pg_temp.als('D');
with x as (delete from public.trip_aemtli where rolle = 'kassier' and trip_id = '10000000-0000-0000-0000-000000000009' returning 1)
select pg_temp.check((select count(*) from x) = 1, 'Ämtli: andere Mitglieder können entfernen');
-- Abmelden
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000009');
insert into public.trip_absagen (trip_id) values ('10000000-0000-0000-0000-000000000009');
select pg_temp.check(not exists (select 1 from public.trip_participants where trip_id = '10000000-0000-0000-0000-000000000009' and member_id = public.uid()), 'Abmelden nimmt von der Reise');
insert into public.trip_participants (trip_id) values ('10000000-0000-0000-0000-000000000009');
select pg_temp.check(not exists (select 1 from public.trip_absagen where trip_id = '10000000-0000-0000-0000-000000000009' and member_id = public.uid()), 'Wieder dabei löscht die Abmeldung');
-- Neue Abstimmung meldet sich bei den Stimmberechtigten
reset role;
select pg_temp.als('');
delete from public.push_queue;
set role authenticated;
select pg_temp.als('A');
select public.propose_sacceri('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000d');
reset role;
select pg_temp.als('');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Neue Abstimmung: De Sacceri') = 0, 'Sacceri: niemand sonst stimmberechtigt, keine Meldung');
select pg_temp.check((select count(*) from public.push_queue where an = '00000000-0000-0000-0000-00000000000a') = 0, 'Wer den Antrag stellt, bekommt keine Meldung');
-- Spitzname: Meldung erst, wenn unterstützt (dann wird abgestimmt), an alle ausser Person, Antragsteller und Unterstützer
set role authenticated;
select pg_temp.als('B');
select public.propose_nickname('00000000-0000-0000-0000-00000000000c', 'Kellermeister');
reset role;
select pg_temp.als('');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Neue Abstimmung: Spitzname') = 0, 'Spitzname: vor der Unterstützung keine Meldung');
set role authenticated;
select pg_temp.als('D');
select public.second_proposal((select id from public.proposals where value = 'Kellermeister'));
reset role;
select pg_temp.als('');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Neue Abstimmung: Spitzname' and an = '00000000-0000-0000-0000-00000000000a') = 1, 'Spitzname: Meldung an die übrigen Stimmberechtigten');
select pg_temp.check((select count(*) from public.push_queue where titel = 'Neue Abstimmung: Spitzname' and an in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d')) = 0, 'Keine Meldung an Person, Antragsteller und Unterstützer');

-- Design-Umfrage: eine Antwort pro Person, lesen nur sich selbst und der Admin
set role authenticated;
select pg_temp.als('B');
insert into public.design_umfrage (wert, text) values (6, 'Mehr Kontrast');
select pg_temp.verboten($q$insert into public.design_umfrage (member_id, wert) values ('00000000-0000-0000-0000-00000000000c', 10)$q$, 'Umfrage nicht im Namen anderer');
select pg_temp.verboten($q$update public.design_umfrage set wert = 10$q$, 'Antwort nicht nachträglich ändern');
select pg_temp.als('C');
insert into public.design_umfrage (wert) values (9);
select pg_temp.check((select count(*) from public.design_umfrage) = 1, 'Mitglied sieht nur die eigene Antwort');
select pg_temp.als('A');
select pg_temp.check((select count(*) from public.design_umfrage) = 2, 'Admin sieht alle Antworten');
reset role;
select pg_temp.als('');

-- Strafen: Anwesende beantragen bis 7 Tage nach dem Anlass, ⅔ der übrigen Anwesenden entscheiden, nach 7 Tagen abgelaufen
insert into public.events (id, title, starts_at) values
  ('20000000-0000-0000-0000-0000000000a1', 'Strafabend', now() - interval '2 days'),
  ('20000000-0000-0000-0000-0000000000a2', 'Alter Abend', now() - interval '9 days'),
  ('20000000-0000-0000-0000-0000000000a3', 'Kommender Abend', now() + interval '3 days');
insert into public.rsvps (event_id, member_id, status) values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'in'),
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'in'),
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c', 'in'),
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000d', 'virtual'),
  ('20000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'in'),
  ('20000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', 'in');
delete from public.push_queue;
set role authenticated;
select pg_temp.als('D');
select pg_temp.verboten($q$select public.propose_strafe('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 20, 'Bescheissen')$q$, 'Strafe: nur Anwesende beantragen (virtuell zählt nicht)');
select pg_temp.als('A');
select pg_temp.verboten($q$select public.propose_strafe('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000d', 20, 'Nicht da')$q$, 'Strafe: nur gegen Anwesende');
select pg_temp.verboten($q$select public.propose_strafe('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 20, 'Ich')$q$, 'Strafe: nicht gegen sich selbst');
select pg_temp.verboten($q$select public.propose_strafe('20000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', 20, 'Zu spät')$q$, 'Strafe: nur bis 7 Tage nach dem Anlass');
select pg_temp.verboten($q$select public.propose_strafe('20000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000b', 20, 'Zu früh')$q$, 'Strafe: nicht vor dem Anlass');
select pg_temp.verboten($q$insert into public.proposals (kind, target_id, event_id, punkte, grund, proposed_by) values ('strafe', '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000a1', 20, 'x', public.uid())$q$, 'Strafe: kein direktes Einfügen an der Funktion vorbei');
select public.propose_strafe('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 20, 'Hat beim Blinddegustieren bescheissen');
select pg_temp.check((select status from public.proposals where kind = 'strafe') = 'open', 'Strafe: offen nach dem Ja des Antragstellers (1 von 2)');
select pg_temp.check((select count(*) from public.eligible_voters((select id from public.proposals where kind = 'strafe'))) = 2, 'Strafe: stimmberechtigt sind die übrigen Anwesenden (A, C)');
select pg_temp.verboten($q$select public.propose_strafe('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 10, 'Nochmals')$q$, 'Strafe: nur ein offener Antrag je Person und Anlass');
select pg_temp.als('B');
select pg_temp.verboten($q$select public.cast_ballot((select id from public.proposals where kind = 'strafe'), false)$q$, 'Strafe: die bestrafte Person stimmt nicht ab');
reset role;
select pg_temp.check((select count(*) from public.push_queue where titel like 'Strafantrag%' and an = '00000000-0000-0000-0000-00000000000c') = 1, 'Strafe: Push an die Stimmberechtigten');
select pg_temp.check((select count(*) from public.push_queue where titel like 'Strafantrag%' and an in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')) = 0, 'Strafe: kein Push an Antragsteller und Bestraften');
set role authenticated;
select pg_temp.als('C');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'strafe'), true) = 'passed', 'Strafe: 2 von 2 → ausgesprochen');
reset role;
select pg_temp.check((select count(*) from public.push_queue where titel = 'Strafe ausgesprochen' and an = '00000000-0000-0000-0000-00000000000b') = 1, 'Strafe: das Mitglied wird per Push informiert');
select pg_temp.check((select count(*) from public.posts where text like 'kassiert eine Strafe%') = 1, 'Strafe: Eintrag auf der Prost-Wand');
-- Ablauf nach 7 Tagen ohne Entscheid
set role authenticated;
select pg_temp.als('C');
select public.propose_strafe('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 10, 'Glas umgeworfen');
reset role;
update public.proposals set created_at = now() - interval '8 days' where kind = 'strafe' and status = 'open';
set role authenticated;
select pg_temp.als('B');
select pg_temp.check(public.cast_ballot((select id from public.proposals where kind = 'strafe' and target_id = '00000000-0000-0000-0000-00000000000a'), true) = 'abgelaufen', 'Strafe: nach 7 Tagen abgelaufen, keine Stimme mehr');
select pg_temp.check((select status from public.proposals where kind = 'strafe' and target_id = '00000000-0000-0000-0000-00000000000a') = 'abgelaufen', 'Strafe: Status abgelaufen gespeichert');
-- Die Magnum der Strafe geht in die Kasse
select pg_temp.als('A');
select pg_temp.check(public.open_magnum_kasse() >= 1, 'Kasse öffnen zählt die Magnum der Strafe');
select pg_temp.check((select eingeloest from public.proposals where kind = 'strafe' and status = 'passed'), 'Strafe: Magnum eingelöst');
reset role;
select pg_temp.als('');

select 'ALLE DB-TESTS GRÜN' as ergebnis;

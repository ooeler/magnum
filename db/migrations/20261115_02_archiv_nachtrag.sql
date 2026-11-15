-- Nachtrag zum Archiv aus dem Chat (Angaben von Othmar): August und September 2026.
-- Gleiches Vorgehen wie 20261115_01: fehlende Beizen mit Standort, Archiv-Anlass an Tagen ohne Anlass, Besuch. Nur mit Mitgliedern.
begin;
create temp table imp_beiz (name text, ort text, lat double precision, lng double precision) on commit drop;
create temp table imp_abend (tag date, name text, ort text) on commit drop;
insert into imp_beiz values
  ('Hinterhofmetzgerei', 'Staad', 47.480800, 9.533055),
  ('Hofbeiz Oberbettenau', 'Jonschwil', 47.428653, 9.096852);
insert into imp_abend values
  ('2026-08-28', 'Hinterhofmetzgerei', 'Staad'),
  ('2026-09-25', 'Hofbeiz Oberbettenau', 'Jonschwil');

insert into public.restaurants (name, place, lat, lng, created_by)
select b.name, b.ort, b.lat, b.lng, null from imp_beiz b
 where exists (select 1 from public.profiles) and not exists (select 1 from public.restaurants r where lower(r.name) = lower(b.name) and lower(coalesce(r.place, '')) = lower(b.ort));

insert into public.events (title, starts_at, location, ortschaft, created_by, archiv)
select public.magnum_titel(a.tag), (a.tag + time '19:00') at time zone 'Europe/Zurich', a.name, a.ort, null, true from imp_abend a
 where exists (select 1 from public.profiles) and not exists (select 1 from public.events e where (e.starts_at at time zone 'Europe/Zurich')::date = a.tag);

insert into public.restaurant_visits (restaurant_id, event_id, visited_on, people, total_chf, created_by)
select r.id, e.id, a.tag, 1, 0, null
  from imp_abend a
  join public.restaurants r on lower(r.name) = lower(a.name) and lower(coalesce(r.place, '')) = lower(a.ort)
  join lateral (select id from public.events e where (e.starts_at at time zone 'Europe/Zurich')::date = a.tag order by starts_at limit 1) e on true
 where exists (select 1 from public.profiles) and not exists (select 1 from public.restaurant_visits v where v.restaurant_id = r.id and v.visited_on = a.tag);
commit;

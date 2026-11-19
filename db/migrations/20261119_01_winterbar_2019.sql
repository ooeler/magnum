-- Korrektur zum Import 20261115_01: Das Weihnachtsessen vom 20.12.2019 war in der Winterbar Niederwil, nicht in der Wyburg Herisau.
-- Laut Chat war die Wyburg nur geplant; Ramon hat am 12.12.2019 die Winterbar reserviert.
-- Ändert nur den importierten Archiv-Anlass und seinen Besuch. Mehrfach ausführbar.
begin;
update public.events
   set location = 'Winterbar', ortschaft = 'Niederwil'
 where archiv and (starts_at at time zone 'Europe/Zurich')::date = date '2019-12-20'
   and lower(coalesce(location, '')) = 'wyburg';

update public.restaurant_visits v
   set restaurant_id = w.id
  from public.restaurants alt, public.restaurants w
 where v.visited_on = date '2019-12-20' and v.restaurant_id = alt.id
   and lower(alt.name) = 'wyburg' and lower(coalesce(alt.place, '')) = 'herisau'
   and lower(w.name) = 'winterbar' and lower(coalesce(w.place, '')) = 'niederwil'
   and not exists (select 1 from public.restaurant_visits x where x.restaurant_id = w.id and x.visited_on = date '2019-12-20');
commit;

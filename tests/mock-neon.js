// Test- und Demo-Ersatz für das Neon-Backend. Wird anstelle von app/config.js ausgeliefert (Tests, npm run demo).
// Bildet nach: Login, Einladungslinks (Edge Function invite), Vorschläge (feedback), Tabellen mit den
// Zugriffsregeln aus db/setup.sql, die Datenbank-Funktionen (Abstimmungen mit ⅔-Mehrheit,
// Organisator, Kasse, Admin) sowie Fotos und Live-Sync zwischen Tabs.
(function () {
  var DBK = "__mg_db", SESS = "__mg_session", USERSK = "__mg_users", FILESK = "__mg_files";
  var PW = "magnum123";
  function get(k) { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
  function ok(d) { return Promise.resolve({ data: d === undefined ? null : d, error: null }) }
  function fail(m, code) { return Promise.resolve({ data: null, error: { message: m, code: code } }) }
  function uuid() { return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16) }) }
  function iso(days, h) { var d = new Date(Date.now() + days * 864e5); if (h != null) d.setHours(h, 0, 0, 0); return d.toISOString() }
  function day(days) { var d = new Date(Date.now() + days * 864e5); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") }

  // ───────────── Testkonten & Club (11 von 12 Plätzen belegt) ─────────────
  var M = { ot: "u-ot", beat: "u-beat", chris: "u-chris", dani: "u-dani", erich: "u-erich", fritz: "u-fritz", gabi: "u-gabi", hans: "u-hans", ivo: "u-ivo", jurg: "u-jurg", kurt: "u-kurt" };
  var BASE_USERS = { "ot@magnum.test": M.ot, "beat@magnum.test": M.beat, "chris@magnum.test": M.chris };
  function users() { var u = get(USERSK) || {}; Object.keys(BASE_USERS).forEach(function (e) { if (!u[e]) u[e] = { id: BASE_USERS[e], pw: PW } }); return u }

  function seed() {
    var P = function (id, n, role, since, dev, extra) { return Object.assign({ id: id, display_name: n, nickname: null, role_title: role, since_year: since, fav_wine: null, specialty: null, device: dev, device_set_by_admin: false, is_admin: false, invited_by: null, last_seen: null, created_at: iso(-400) }, extra || {}) };
    var d = {
      settings: [{ id: 1, goal_title: "30 Zusagen bis zum Chlaus-Magnum = Apéro für alle", goal_target: 30, magnum_price: 45 }],
      app_status: [{ id: "main", maintenance: false }],
      profiles: [
        P(M.ot, "Ot", "Präsident", 2009, "iphone", { is_admin: true, fav_wine: "Cornalin", specialty: "Reden nach Mitternacht" }),
        P(M.beat, "Beat", "Kassier", 2011, "android", { device_set_by_admin: true, fav_wine: "Riesling", specialty: "Bezahlt nie die letzte Runde" }),
        P(M.chris, "Chris", "Reiseleiter", 2012, "iphone", { nickname: "Navi", fav_wine: "Barolo", specialty: "Findet jede Besenbeiz" }),
        P(M.dani, "Dani", "Kellermeister", 2015, "iphone"), P(M.erich, "Erich", "Aktuar", 2018, "iphone"),
        P(M.fritz, "Fritz", "Mitglied", 2016, "android", { device_set_by_admin: true }), P(M.gabi, "Gabi", "Mitglied", 2013, "iphone"),
        P(M.hans, "Hans", "Mitglied", 2017, "iphone"), P(M.ivo, "Ivo", "Mitglied", 2019, "android", { device_set_by_admin: true }),
        P(M.jurg, "Jürg", "Mitglied", 2021, "iphone"), P(M.kurt, "Kurt", "Mitglied", 2024, "iphone")
      ],
      events: [
        { id: "e-past1", title: "Sommer-Stamm", starts_at: iso(-40, 19), location: "Rest. Sonne", organizer_id: M.dani, created_by: M.dani, created_at: iso(-60) },
        { id: "e-past2", title: "Weinprobe Herbst", starts_at: iso(-12, 19), location: "Weinstube Bacchus", organizer_id: M.chris, created_by: M.chris, created_at: iso(-30) },
        { id: "e-1", title: "Herbst-Stamm", starts_at: iso(7, 19), location: "Pinte zum Hirschen", organizer_id: M.kurt, created_by: M.kurt, created_at: iso(-5) },
        { id: "e-2", title: "Chlaus-Magnum", starts_at: iso(35, 18), location: "[Ort]", organizer_id: null, created_by: M.ot, created_at: iso(-5) },
        { id: "e-3", title: "Neujahrs-Degustation", starts_at: iso(70, 19), location: "[Ort]", organizer_id: null, created_by: M.ot, created_at: iso(-5) }
      ],
      rsvps: [], magnums: [{ id: "m-1", event_id: "e-1", wine: "Cornalin 2019", brought_by: M.kurt, created_at: iso(-2) }],
      magnum_guests: [{ id: "g-1", magnum_id: "m-1", name: "Peter (Gast von Kurt)", added_by: M.kurt, created_at: iso(-2) }],
      rides: [{ id: "r-1", event_id: "e-1", driver_id: M.jurg, direction: "Richtung Wil", seats: 3, created_at: iso(-1) }], ride_passengers: [], card_members: [], gaeste: [], karte_der_woche: [],
      trips: [
        { id: "t-bordeaux", title: "Bordeaux", starts_on: day(-60), ends_on: day(-57), program: "Saint-Émilion, Médoc, Austern in Arcachon", seats: 12, color: "#5A1F2E", ok_id: M.chris, kassier_id: M.beat, sacceri_id: M.dani, created_by: M.chris, created_at: iso(-200) },
        { id: "t-wallis", title: "Wallis", starts_on: day(190), ends_on: day(192), program: "Weinwanderung Sierre–Salgesch, Raclette", seats: 12, color: "#6E2433", ok_id: M.chris, kassier_id: null, sacceri_id: null, created_by: M.chris, created_at: iso(-20) }
      ],
      trip_participants: [], trip_photos: [], proposals: [
        { id: "p-old", kind: "sacceri", target_id: M.dani, trip_id: "t-bordeaux", value: null, proposed_by: M.ot, seconded_by: null, status: "passed", yes_weight: 6, total_weight: 7, created_at: iso(-56), decided_at: iso(-56) }
      ], ballots: [],
      posts: [
        { id: "po-1", author_id: M.chris, text: "hat die Reise nach Wallis eröffnet. Wer kommt mit?", created_at: iso(-20) },
        { id: "po-2", author_id: M.dani, text: "ist De Sacceri der Reise Bordeaux!", created_at: iso(-56) }
      ], post_prosts: [{ post_id: "po-2", member_id: M.beat }],
      cards: [
        { id: "c-1", title: "Die 6-Liter-Nacht", rarity: "legend", story: "Der Abend, an dem die Methusalem-Flasche geöffnet wurde.", happened_on: "2019-06-15", place: "Wallis", who: "Ot, Chris, Dani", photo_path: null, created_by: M.ot, created_at: iso(-300) },
        { id: "c-2", title: "Sonnenaufgang im Rebberg", rarity: "magic", story: "Alle wurden still und haben nur noch geschaut.", happened_on: "2021-09-11", place: "Elsass", who: "Alle", photo_path: null, created_by: M.chris, created_at: iso(-250) },
        { id: "c-3", title: "Schwimmen im Brunnen", rarity: "geil", story: "Um 2 Uhr nachts schien es eine gute Idee.", happened_on: "2022-07-02", place: "[Ort]", who: "Beat, Erich", photo_path: null, created_by: M.beat, created_at: iso(-200) }
      ],
      drinks: [],
      sayings: [
        { id: "s-1", text: "Eine Magnum ist keine Flasche, sondern eine Einladung.", author_id: M.ot, created_at: iso(-30) },
        { id: "s-2", text: "Wer früh geht, verpasst immer den besten Wein.", author_id: M.chris, created_at: iso(-20) },
        { id: "s-3", text: "Zwei Gläser sind Genuss, das dritte ist Freundschaft.", author_id: M.dani, created_at: iso(-10) }
      ], saying_prosts: [{ saying_id: "s-1", member_id: M.beat }, { saying_id: "s-1", member_id: M.dani }],
      restaurants: [
        { id: "re-1", name: "Rest. Sonne", place: "[Ort]", lat: null, lng: null, created_by: M.dani, created_at: iso(-40) },
        { id: "re-2", name: "Weinstube Bacchus", place: "[Ort]", lat: null, lng: null, created_by: M.chris, created_at: iso(-12) }
      ],
      restaurant_visits: [
        { id: "rv-1", restaurant_id: "re-1", visited_on: day(-40), people: 9, total_chf: 684, receipt_path: null, created_by: M.dani, created_at: iso(-40) },
        { id: "rv-2", restaurant_id: "re-2", visited_on: day(-12), people: 11, total_chf: 902, receipt_path: null, created_by: M.chris, created_at: iso(-12) }
      ],
      restaurant_ratings: [
        { restaurant_id: "re-1", member_id: M.dani, preis: 4, gesellig: 4, willkommen: 5, updated_at: iso(-40) },
        { restaurant_id: "re-2", member_id: M.chris, preis: 3, gesellig: 5, willkommen: 4, updated_at: iso(-12) }
      ],
      feedback: [
        { id: 7, user_id: M.gabi, kind: "idee", title: "💡 Weinkarte im Club", body: "", labels: [], status: "umgesetzt", issue_number: 7, issue_url: "https://github.com/ooeler/magnum/issues/7", error: null, created_at: iso(-15) },
        { id: 9, user_id: M.beat, kind: "fehler", title: "🐞 Push kommt doppelt bei Android", body: "", labels: [], status: "erfasst", issue_number: 9, issue_url: "https://github.com/ooeler/magnum/issues/9", error: null, created_at: iso(-3) }
      ],
      admin_log: [], __invites: [], __seq: 10
    };
    // Anwesenheit: Ot war an beiden letzten Anlässen dabei (Streak 2)
    [M.ot, M.beat, M.chris, M.dani, M.erich, M.gabi, M.hans, M.ivo].forEach(function (m) { d.rsvps.push({ event_id: "e-past1", member_id: m, status: "in", redeemed: false, updated_at: iso(-41) }) });
    [M.ot, M.beat, M.chris, M.dani, M.fritz, M.gabi, M.jurg, M.kurt, M.ivo].forEach(function (m) { d.rsvps.push({ event_id: "e-past2", member_id: m, status: "in", redeemed: false, updated_at: iso(-13) }) });
    d.rsvps.push({ event_id: "e-past2", member_id: M.erich, status: "virtual", redeemed: false, updated_at: iso(-13) });
    [M.beat, M.chris, M.dani, M.kurt, M.jurg, M.hans].forEach(function (m) { d.rsvps.push({ event_id: "e-1", member_id: m, status: "in", redeemed: false, updated_at: iso(-2) }) });
    [M.ot, M.beat, M.chris, M.dani].forEach(function (m) { d.trip_participants.push({ trip_id: "t-wallis", member_id: m }) });
    [M.ot, M.beat, M.chris, M.dani, M.erich, M.gabi].forEach(function (m) { d.trip_participants.push({ trip_id: "t-bordeaux", member_id: m }) });
    for (var i = 0; i < 6; i++) d.trip_photos.push({ id: "tp-" + i, trip_id: "t-bordeaux", path: "seed/bordeaux-" + i + ".jpg", uploaded_by: M.chris, created_at: iso(-55 + i / 10) });
    // Getränkefotos: Beat standfest, Chris solide
    [[M.beat, -12, ["wein", "wein", "magnum", "wein", "bier"]], [M.beat, -40, ["wein", "magnum", "wein", "schnaps"]], [M.chris, -12, ["wein", "wasser", "wein"]], [M.ot, -12, ["wein", "magnum", "wasser"]]].forEach(function (x) {
      x[2].forEach(function (k, j) { d.drinks.push({ id: uuid(), member_id: x[0], drunk_on: day(x[1]), kind: k, photo_path: null, created_at: iso(x[1] + j / 100) }) });
    });
    return d;
  }
  function db() { var d = get(DBK); if (!d) { d = seed(); set(DBK, d) } return d }
  function save(d) { set(DBK, d) }

  // ───────────── Regeln (Spiegel von db/setup.sql) ─────────────
  var OWNER = { restaurant_ratings: "member_id", rsvps: "member_id", trip_participants: "member_id", drinks: "member_id", saying_prosts: "member_id", post_prosts: "member_id",
    ride_passengers: "passenger_id", rides: "driver_id", restaurants: "created_by", restaurant_visits: "created_by", events: "created_by", magnums: "brought_by", magnum_guests: "added_by",
    trip_photos: "uploaded_by", cards: "created_by", gaeste: "added_by", sayings: "author_id", posts: "author_id", trips: "created_by" };
  var PK = { card_members: ["card_id", "member_id"], rsvps: ["event_id", "member_id"], restaurant_ratings: ["restaurant_id", "member_id"], trip_participants: ["trip_id", "member_id"], saying_prosts: ["saying_id", "member_id"],
    post_prosts: ["post_id", "member_id"], ride_passengers: ["ride_id", "passenger_id"], ballots: ["proposal_id", "voter_id"] };
  var PERSONAL = ["restaurant_ratings", "rsvps", "trip_participants", "drinks", "saying_prosts", "post_prosts", "ride_passengers", "rides"];
  var COLS = { profiles: ["display_name", "fav_wine", "specialty"], trips: ["title", "starts_on", "ends_on", "program", "seats", "color", "ok_id", "kassier_id"],
    events: ["title", "starts_at", "location", "ortschaft"], ride_passengers: ["stars_safe", "stars_punctual", "stars_mood", "points_given", "rated_at"],
    rsvps: ["event_id", "member_id", "status", "updated_at"], posts: ["text"], sayings: ["text"] };
  var READONLY = ["karte_der_woche", "settings", "proposals", "ballots", "admin_log", "feedback"];
  var CASCADE = { events: [["rsvps", "event_id"], ["magnums", "event_id"], ["rides", "event_id"], ["gaeste", "event_id"]], magnums: [["magnum_guests", "magnum_id"]], rides: [["ride_passengers", "ride_id"]],
    cards: [["card_members", "card_id"]], trips: [["gaeste", "trip_id"], ["trip_participants", "trip_id"], ["trip_photos", "trip_id"], ["proposals", "trip_id"]], posts: [["post_prosts", "post_id"]], sayings: [["saying_prosts", "saying_id"]],
    restaurants: [["restaurant_visits", "restaurant_id"], ["restaurant_ratings", "restaurant_id"]], proposals: [["ballots", "proposal_id"]] };
  var AS = null; // Tests: als andere Person handeln (window.__mg.as)
  function me() { if (AS) return AS; var s = get(SESS); return s ? s.user.id : null }
  function member(d) { var u = me(); return u && d.profiles.some(function (p) { return p.id == u }) }
  function admin(d) { var u = me(), p = d.profiles.find(function (x) { return x.id == u }); return !!(p && p.is_admin) }
  var RLS = function (t) { return fail('new row violates row-level security policy for table "' + t + '"', "42501") };
  function notify() { try { localStorage.setItem("__mg_ping", String(Date.now())) } catch (e) {} CH.forEach(function (c) { setTimeout(function () { c.cb({ table: "*" }) }, 50) }) }
  function pkMatch(t, a, b) { var k = PK[t] || ["id"]; return k.every(function (c) { return a[c] == b[c] }) }
  function removeCascade(d, t, row) {
    (CASCADE[t] || []).forEach(function (c) {
      var gone = d[c[0]].filter(function (r) { return r[c[1]] == row.id }); d[c[0]] = d[c[0]].filter(function (r) { return r[c[1]] != row.id });
      gone.forEach(function (g) { removeCascade(d, c[0], g) });
    });
  }
  function checkRide(d, row, isNew) {
    var r = d.rides.find(function (x) { return x.id == row.ride_id }); if (!r) return "Fahrt nicht gefunden";
    if (r.driver_id == row.passenger_id) return "Du kannst nicht bei dir selbst mitfahren";
    if (isNew && d.ride_passengers.filter(function (x) { return x.ride_id == row.ride_id }).length >= r.seats) return "Das Auto ist voll";
    if (isNew && tag(eventOf(d, r.event_id).starts_at) < day(0)) return "Der Anlass ist vorbei";
    if (isNew && (row.stars_safe != null || row.stars_punctual != null || row.stars_mood != null || row.points_given != null || row.rated_at != null)) return "Bewerten geht erst nach dem Anlass";
    if (!isNew && new Date(eventOf(d, r.event_id).starts_at) > new Date()) return "Bewerten geht erst nach dem Anlass";
    return null;
  }
  function tag(s) { var d = new Date(s); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") }
  function eventOf(d, id) { return d.events.find(function (e) { return e.id == id }) || { starts_at: new Date().toISOString() } }
  // Spiegel der Trigger check_event, check_rsvp, check_trip und check_trip_participant
  function checkRow(d, t, r, old, loeschen) {
    if (admin(d)) return null;
    if (t == "events") {
      if (!old && r.organizer_id) return "Der Organisator trägt sich selbst ein";
      if ((!old || r.starts_at != old.starts_at) && tag(r.starts_at) < day(0)) return "Ein Anlass kann nicht in der Vergangenheit liegen";
    }
    if (t == "rsvps") {
      if (old && !loeschen && r.event_id != old.event_id) return "Der Anlass lässt sich nicht ändern";
      if (tag(eventOf(d, r.event_id).starts_at) < day(0)) return "Der Anlass ist vorbei, die Anmeldung ist geschlossen";
    }
    if (t == "trips") {
      if ((!old || r.starts_on != old.starts_on) && r.starts_on < day(0)) return "Eine Reise kann nicht in der Vergangenheit liegen";
      if (old && old.created_by != me() && ["title", "starts_on", "ends_on", "program", "seats", "color"].some(function (c) { return r[c] != old[c] })) return "Nur wer die Reise erfasst hat, kann sie ändern";
    }
    if (t == "trip_participants" && !old) {
      var tr = d.trips.find(function (x) { return x.id == r.trip_id });
      if (tr.starts_on < day(0)) return "Die Reise hat schon begonnen";
    }
    return null;
  }

  function Q(t) { this.t = t; this.op = "select"; this.fl = []; this.o = null; this.lim = null; this.mode = null; this.payload = null; this.ret = false; this.head = false; this.count = false }
  Q.prototype.select = function (c, o) { if (this.op != "select") this.ret = true; if (o && o.head) this.head = true; if (o && o.count) this.count = true; return this };
  Q.prototype.eq = function (c, v) { this.fl.push(function (r) { return r[c] == v }); return this };
  Q.prototype.neq = function (c, v) { this.fl.push(function (r) { return r[c] != v }); return this };
  Q.prototype.is = function (c, v) { this.fl.push(function (r) { return v == null ? r[c] == null : r[c] === v }); return this };
  Q.prototype.gt = function (c, v) { this.fl.push(function (r) { return r[c] > v }); return this };
  Q.prototype.gte = function (c, v) { this.fl.push(function (r) { return r[c] >= v }); return this };
  Q.prototype.in = function (c, v) { this.fl.push(function (r) { return v.indexOf(r[c]) >= 0 }); return this };
  Q.prototype.order = function (c, o) { this.o = [c, !o || o.ascending !== false]; return this };
  Q.prototype.limit = function (n) { this.lim = n; return this };
  Q.prototype.single = function () { this.mode = "single"; return this };
  Q.prototype.maybeSingle = function () { this.mode = "maybe"; return this };
  Q.prototype.insert = function (p) { this.op = "insert"; this.payload = p; return this };
  Q.prototype.upsert = function (p) { this.op = "upsert"; this.payload = p; return this };
  Q.prototype.update = function (p) { this.op = "update"; this.payload = p; return this };
  Q.prototype.delete = function () { this.op = "delete"; return this };
  Q.prototype.then = function (a, b) { return run(this).then(a, b) };
  function match(q, r) { return q.fl.every(function (f) { return f(r) }) }
  function shape(q, rows) {
    if (q.o) rows.sort(function (a, b) { var x = a[q.o[0]], y = b[q.o[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (q.o[1] ? 1 : -1) });
    if (q.lim != null) rows = rows.slice(0, q.lim);
    rows = JSON.parse(JSON.stringify(rows));
    if (q.head) return { data: null, count: rows.length, error: null };
    if (q.mode == "single") return rows.length == 1 ? { data: rows[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
    if (q.mode == "maybe") return { data: rows[0] || null, error: null };
    return { data: rows, error: null, count: q.count ? rows.length : null };
  }
  function run(q) {
    var d = db(), t = q.t, u = me();
    if (t == "app_status" && q.op == "select") return Promise.resolve(shape(q, d.app_status.filter(function (r) { return match(q, r) })));
    if (!u) return fail("JWT expired");
    if (!d[t]) return fail('relation "public.' + t + '" does not exist');
    if (q.op == "select") return Promise.resolve(shape(q, member(d) ? d[t].filter(function (r) { return match(q, r) }) : []));
    if (d.app_status[0].maintenance) return fail("Datenbank nicht erreichbar");
    if (!member(d) || READONLY.indexOf(t) >= 0) return RLS(t);
    var own = OWNER[t], out = [];
    if (q.op == "insert" || q.op == "upsert") {
      var rows = [].concat(q.payload);
      for (var i = 0; i < rows.length; i++) {
        var r = Object.assign({}, rows[i]);
        if (own && r[own] == null) r[own] = u;
        if (own && r[own] != u) return RLS(t);
        if (t == "trips" && r.sacceri_id) return RLS(t);
        if (t == "card_members" && !(admin(d) || d.cards.some(function (c) { return c.id == r.card_id && c.created_by == u }))) return RLS(t);
        if (t == "rsvps" && "redeemed" in r) return fail("permission denied for table rsvps", "42501");
        var ex = d[t].find(function (x) { return pkMatch(t, x, r) && (PK[t] || r.id) });
        if (ex && q.op == "insert") return fail("duplicate key value violates unique constraint", "23505");
        var bad = checkRow(d, t, r, ex); if (bad) return fail(bad);
        if (t == "posts" || t == "sayings") r.created_at = new Date().toISOString();
        if (t == "ride_passengers") { var e = checkRide(d, r, !ex); if (e) return fail(e) }
        if (ex) { Object.assign(ex, r); out.push(ex); continue }
        if (!PK[t] && r.id == null) r.id = uuid();
        if ("created_at" in (d[t][0] || { created_at: 1 }) && !r.created_at && !PK[t]) r.created_at = new Date().toISOString();
        if (t == "rsvps" && r.redeemed == null) r.redeemed = false;
        d[t].push(r); out.push(r);
      }
      save(d); notify();
      return Promise.resolve(q.ret ? shape(q, out) : { data: null, error: null });
    }
    var hit = d[t].filter(function (r) { return match(q, r) });
    if (q.op == "update") {
      var cols = Object.keys(q.payload);
      if (COLS[t] && cols.some(function (c) { return COLS[t].indexOf(c) < 0 })) return fail("permission denied for table " + t, "42501");
      for (var h = 0; h < hit.length; h++) {
        var r = hit[h], allowed = t == "profiles" ? r.id == u : t == "trips" ? true : t == "events" ? (r.created_by == u || r.organizer_id == u || admin(d)) : PERSONAL.indexOf(t) >= 0 ? r[own] == u : (r[own] == u || admin(d));
        if (!allowed) continue;
        var neu = Object.assign({}, r, q.payload), e2 = t == "ride_passengers" ? checkRide(d, neu, false) : checkRow(d, t, neu, r);
        if (e2) return fail(e2);
        Object.assign(r, q.payload); out.push(r);
      }
      save(d); notify();
      return Promise.resolve(q.ret ? shape(q, out) : { data: null, error: null });
    }
    if (q.op == "delete") {
      for (var k = 0; k < hit.length; k++) {
        var r2 = hit[k], darf = t == "card_members" ? (admin(d) || d.cards.some(function (c) { return c.id == r2.card_id && c.created_by == u })) : t == "trips" ? (r2.created_by == u || admin(d)) : own && (r2[own] == u || admin(d));
        if (!darf) continue;
        var e3 = t == "rsvps" ? checkRow(d, t, r2, r2, true) : null; if (e3) return fail(e3);
        d[t] = d[t].filter(function (x) { return x !== r2 }); removeCascade(d, t, r2); out.push(r2);
      }
      save(d); notify();
      return Promise.resolve({ data: null, error: null });
    }
    return fail("unsupported");
  }

  // ───────────── Datenbank-Funktionen ─────────────
  function eligible(d, p) {
    if (p.kind == "sacceri") return p.voters || [];
    return d.profiles.filter(function (x) { return x.id != p.target_id }).map(function (x) { return x.id });
  }
  function resolve(d, p) {
    if (p.status != "open") return p.status;
    if (p.kind == "nickname" && !p.seconded_by) return "open";
    var V = eligible(d, p), tot = 0, yes = 0, no = 0, by = {};
    d.ballots.filter(function (b) { return b.proposal_id == p.id }).forEach(function (b) { by[b.voter_id] = b.vote });
    V.forEach(function (v) { tot++; if (by[v] === true) yes++; else if (by[v] === false) no++ });
    var need = Math.ceil(tot * 2 / 3);
    if (tot > 0 && yes >= need) {
      Object.assign(p, { status: "passed", yes_weight: yes, total_weight: tot, decided_at: new Date().toISOString() });
      if (p.kind == "nickname") { d.profiles.find(function (x) { return x.id == p.target_id }).nickname = p.value; d.posts.push({ id: uuid(), author_id: p.target_id, text: "heisst ab jetzt «" + p.value + "».", created_at: new Date().toISOString() }) }
      else { var tr = d.trips.find(function (x) { return x.id == p.trip_id }); tr.sacceri_id = p.target_id; d.posts.push({ id: uuid(), author_id: p.target_id, text: "ist De Sacceri der Reise " + tr.title + "!", created_at: new Date().toISOString() }) }
      return "passed";
    }
    if (no > tot - need) { Object.assign(p, { status: "rejected", yes_weight: yes, total_weight: tot, decided_at: new Date().toISOString() }); return "rejected" }
    return "open";
  }
  function ballot(d, pid, voter, vote) { d.ballots = d.ballots.filter(function (b) { return !(b.proposal_id == pid && b.voter_id == voter) }); d.ballots.push({ proposal_id: pid, voter_id: voter, vote: vote, created_at: new Date().toISOString() }) }
  var RPC = {
    me: function (d, u) { var p = d.profiles.find(function (x) { return x.id == u }); if (!p) return null; var prev = p.last_seen; p.last_seen = new Date().toISOString(); return { id: u, is_admin: p.is_admin, prev_seen: prev } },
    magnum_termine: function () { return 0 },
    set_organizer: function (d, u, a) {
      var e = d.events.find(function (x) { return x.id == a.p_event }); if (!e) throw "Anlass nicht gefunden";
      if (!(admin(d) || e.created_by == u || e.organizer_id == u)) throw "Das dürfen nur Organisator und Administrator";
      e.organizer_id = a.p_member;
    },
    admin_set_rsvp: function (d, u, a) {
      if (!admin(d)) throw "Nur der Administrator trägt Anwesenheit nach";
      d.rsvps = d.rsvps.filter(function (x) { return !(x.event_id == a.p_event && x.member_id == a.p_member) });
      if (a.p_status) d.rsvps.push({ event_id: a.p_event, member_id: a.p_member, status: a.p_status, redeemed: false, updated_at: new Date().toISOString() });
    },
    claim_organizer: function (d, u, a) {
      var e = d.events.find(function (x) { return x.id == a.p_event }); if (!e || e.organizer_id == u || tag(e.starts_at) < day(0)) throw "Der Anlass lässt sich nicht übernehmen";
      e.organizer_id = u; var r = d.rsvps.find(function (x) { return x.event_id == e.id && x.member_id == u });
      if (r) r.status = "in"; else d.rsvps.push({ event_id: e.id, member_id: u, status: "in", redeemed: false, updated_at: new Date().toISOString() });
    },
    open_magnum_kasse: function (d, u) { if (!admin(d)) throw "Nur der Administrator öffnet die Kasse"; var n = 0; d.rsvps.forEach(function (r) { if (r.status == "virtual" && !r.redeemed) { r.redeemed = true; n++ } }); return n },
    admin_set_device: function (d, u, a) {
      if (!admin(d)) throw "Nur der Administrator darf den Gerätetyp ändern";
      var p = d.profiles.find(function (x) { return x.id == a.p_member }); if (!p) throw "Mitglied nicht gefunden"; if (p.device == a.p_device) return;
      d.admin_log.push({ id: ++d.__seq, admin_id: u, member_id: p.id, action: "Gerätetyp " + p.device + " → " + a.p_device, created_at: new Date().toISOString() });
      p.device = a.p_device; p.device_set_by_admin = true;
    },
    admin_set_admin: function (d, u, a) {
      if (!admin(d)) throw "Nur der Administrator vergibt diese Rolle";
      if (!a.p_admin && !d.profiles.some(function (x) { return x.is_admin && x.id != a.p_member })) throw "Es braucht mindestens einen Administrator";
      d.profiles.find(function (x) { return x.id == a.p_member }).is_admin = !!a.p_admin;
    },
    admin_set_role: function (d, u, a) {
      if (!admin(d)) throw "Nur der Administrator darf Funktionen vergeben";
      var p = d.profiles.find(function (x) { return x.id == a.p_member }); p.role_title = String(a.p_role).trim().slice(0, 40);
      d.admin_log.push({ id: ++d.__seq, admin_id: u, member_id: p.id, action: "Funktion → " + p.role_title, created_at: new Date().toISOString() });
    },
    propose_sacceri: function (d, u, a) {
      if (a.p_target == u) throw "Du kannst dich nicht selbst auszeichnen";
      if (!d.trip_participants.some(function (t) { return t.trip_id == a.p_trip && t.member_id == a.p_target })) throw "Nur Mitreisende können ausgezeichnet werden";
      var tr = d.trips.find(function (x) { return x.id == a.p_trip }); if (tr.sacceri_id) throw "Diese Reise hat schon einen Sacceri";
      if (d.proposals.some(function (p) { return p.kind == "sacceri" && p.trip_id == a.p_trip && p.status == "open" })) throw "duplicate key value violates unique constraint";
      var p = { id: uuid(), kind: "sacceri", target_id: a.p_target, trip_id: a.p_trip, value: null, proposed_by: u, seconded_by: null, voters: d.trip_participants.filter(function (t) { return t.trip_id == a.p_trip }).map(function (t) { return t.member_id }), status: "open", created_at: new Date().toISOString() };
      d.proposals.push(p);
      if (d.trip_participants.some(function (t) { return t.trip_id == a.p_trip && t.member_id == u })) ballot(d, p.id, u, true);
      resolve(d, p); return p.id;
    },
    propose_nickname: function (d, u, a) {
      if (a.p_target == u) throw "Spitznamen werden von anderen vergeben";
      if (d.proposals.some(function (p) { return p.kind == "nickname" && p.target_id == a.p_target && p.status == "open" })) throw "duplicate key value violates unique constraint";
      var p = { id: uuid(), kind: "nickname", target_id: a.p_target, trip_id: null, value: String(a.p_nick).trim().slice(0, 40), proposed_by: u, seconded_by: null, status: "open", created_at: new Date().toISOString() };
      d.proposals.push(p); ballot(d, p.id, u, true); return p.id;
    },
    second_proposal: function (d, u, a) {
      var p = d.proposals.find(function (x) { return x.id == a.p_proposal });
      if (!p || p.kind != "nickname" || p.status != "open") throw "Nicht möglich";
      if (p.seconded_by) throw "Der Vorschlag ist schon unterstützt";
      if (p.proposed_by == u || p.target_id == u) throw "Die zweite Unterstützung muss von jemand anderem kommen";
      p.seconded_by = u; ballot(d, p.id, u, true); return resolve(d, p);
    },
    cast_ballot: function (d, u, a) {
      var p = d.proposals.find(function (x) { return x.id == a.p_proposal });
      if (!p || p.status != "open") throw "Die Abstimmung ist abgeschlossen";
      if (p.kind == "nickname" && !p.seconded_by) throw "Erst braucht es eine zweite Unterstützung";
      if (eligible(d, p).indexOf(u) < 0) throw "Du bist für diese Abstimmung nicht stimmberechtigt";
      ballot(d, p.id, u, !!a.p_yes); return resolve(d, p);
    }
  };
  function rpc(fn, a) {
    var d = db(), u = me();
    if (!u) return fail("JWT expired");
    if (!RPC[fn]) return fail("function " + fn + " does not exist");
    if (fn != "me" && !member(d)) return fail("Nur Mitglieder");
    if (fn == "me" && window.__mg_warten) return new Promise(function (ok2) { window.__mg_weiter = function () { window.__mg_warten = false; ok2(rpc(fn, a)) } });
    try { var r = RPC[fn](d, u, a || {}); save(d); notify(); return ok(r === undefined ? null : r) } catch (e) { return fail(String(e.message || e)) }
  }

  // ───────────── Edge Functions ─────────────
  function fnFail(m) { return Promise.resolve({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: function () { return Promise.resolve({ error: m }) } } } }) }
  function token() { var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", s = ""; for (var i = 0; i < 43; i++) s += c[Math.random() * 64 | 0]; return s }
  var FN = {
    invite: function (b) {
      var d = db(), now = new Date().toISOString(), INVALID = "Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon verwendet.";
      if (b.action == "check" || b.action == "join") {
        if (!/^[A-Za-z0-9_-]{43}$/.test(String(b.token || ""))) return fnFail("Dieser Einladungslink ist ungültig.");
        var inv = d.__invites.find(function (x) { return x.token == b.token && !x.used_at && x.expires_at > now });
        if (!inv) return fnFail(INVALID);
        var from = d.profiles.find(function (p) { return p.id == inv.created_by });
        if (b.action == "check") return ok({ ok: true, from: from ? from.display_name : null });
        var name = String(b.name || "").trim(), email = String(b.email || "").trim().toLowerCase(), U = users();
        if (name.length < 2) return fnFail("Bitte deinen Namen eingeben (2–40 Zeichen).");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fnFail("Bitte eine gültige Mail-Adresse eingeben.");
        if (String(b.password || "").length < 8) return fnFail("Das Passwort braucht mindestens 8 Zeichen.");
        if (U[email]) return fnFail("Diese Adresse hat bereits ein Konto. Bitte normal anmelden.");
        var id = "u-" + uuid();
        U[email] = { id: id, pw: b.password }; set(USERSK, U);
        d.profiles.push({ id: id, display_name: name.slice(0, 40), nickname: null, role_title: "Mitglied", since_year: new Date().getFullYear(), fav_wine: null, specialty: null,
          device: b.device == "android" ? "android" : "iphone", device_set_by_admin: false, is_admin: false, invited_by: inv.created_by, last_seen: null, created_at: now });
        inv.used_at = now; inv.used_by = id; save(d); notify();
        return ok({ ok: true, email: email });
      }
      var u = me(); if (!u) return fnFail("Nicht angemeldet");
      if (!member(d)) return fnFail("Nur Mitglieder dürfen einladen.");
      if (b.action == "create") {
        var t = token(); d.__invites.push({ id: ++d.__seq, token: t, created_by: u, created_at: now, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), used_at: null }); save(d);
        return ok({ ok: true, token: t });
      }
      if (b.action == "list") return ok({ ok: true, items: d.__invites.filter(function (x) { return !x.used_at && x.expires_at > now }).reverse().map(function (x) { return { id: x.id, created_at: x.created_at, expires_at: x.expires_at, mine: x.created_by == u, from: x.created_by } }) });
      if (b.action == "revoke") { d.__invites = d.__invites.filter(function (x) { return !(x.id == b.id && !x.used_at && (x.created_by == u || admin(d))) }); save(d); return ok({ ok: true }) }
      return fnFail("unknown action");
    },
    feedback: function (b) {
      var d = db(), u = me(); if (!u) return fnFail("Nicht angemeldet"); if (!member(d)) return fnFail("Kein Mitglied");
      var K = { idee: ["verbesserung", "💡"], fehler: ["fehler", "🐞"], wunsch: ["wunsch", "🍷"] }, title = String(b.title || "").trim().replace(/\s+/g, " ");
      if (!K[b.kind]) return fnFail("Bitte Idee, Fehler oder Wunsch wählen.");
      if (title.length < 3 || title.length > 100) return fnFail("Der Titel muss 3–100 Zeichen lang sein.");
      var day1 = new Date(Date.now() - 864e5).toISOString();
      if (d.feedback.filter(function (f) { return f.user_id == u && f.created_at >= day1 }).length >= 5) return fnFail("Maximal 5 Vorschläge pro Tag.");
      d.feedback.push({ id: ++d.__seq, user_id: u, kind: b.kind, title: K[b.kind][1] + " " + title, body: String(b.text || ""), labels: [K[b.kind][0], "aus-der-app"], status: "neu", issue_number: null, issue_url: null, created_at: new Date().toISOString() });
      save(d); notify(); return ok({ queued: true });
    }
  };

  // ───────────── Fotos ─────────────
  var FILES = get(FILESK) || {};
  var COLORS = ["#6E2433", "#8A5A3C", "#3D4A2E", "#5A3E5E", "#7A2E2E", "#4A5A6E", "#9A6A2A", "#3E2A2E"];
  function placeholder(p) { var i = 0; for (var k = 0; k < p.length; k++) i += p.charCodeAt(k); return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="' + COLORS[i % COLORS.length] + '"/></svg>') }
  var storage = { from: function () { return {
    upload: function (path, blob) {
      var u = me(); if (!u) return fail("JWT expired");
      if (path.split("/")[1] != u || ["drinks", "trips", "cards", "receipts"].indexOf(path.split("/")[0]) < 0) return RLS("objects");
      return new Promise(function (res) {
        var fr = new FileReader(); fr.onload = function () { FILES[path] = fr.result; try { localStorage.setItem(FILESK, JSON.stringify(FILES)) } catch (e) {} res({ data: { path: path }, error: null }) };
        fr.onerror = function () { res({ data: null, error: { message: "Upload fehlgeschlagen" } }) }; fr.readAsDataURL(blob);
      });
    },
    createSignedUrls: function (paths) { return me() ? ok(paths.map(function (p) { return { path: p, signedUrl: FILES[p] || placeholder(p), error: null } })) : fail("JWT expired") }
  } } };

  // ───────────── Login & Live-Sync ─────────────
  var SUBS = [], CH = [];
  function emit(ev, s) { SUBS.forEach(function (cb) { cb(ev, s) }) }
  addEventListener("storage", function (e) { if (e.key == "__mg_ping") CH.forEach(function (c) { c.cb({ table: "*" }) }) });
  function createClient() {
    var auth = {
      onAuthStateChange: function (cb) { SUBS.push(cb); setTimeout(function () { cb("INITIAL_SESSION", get(SESS)) }, 0); return { data: { subscription: { unsubscribe: function () {} } } } },
      signInWithPassword: function (c) {
        var U = users(), x = U[String(c.email).toLowerCase()];
        if (!x || x.pw !== c.password) return fail("Invalid login credentials");
        var s = { access_token: "t", user: { id: x.id, email: c.email } }; set(SESS, s); setTimeout(function () { emit("SIGNED_IN", s) }, 0); return ok({ session: s });
      },
      signOut: function () { localStorage.removeItem(SESS); setTimeout(function () { emit("SIGNED_OUT", null) }, 0); return ok() },
      resetPasswordForEmail: function () { return ok({}) },
      updateUser: function (u) { var s = get(SESS); if (!s) return fail("Not logged in"); var U = users(); U[s.user.email].pw = u.password; set(USERSK, U); setTimeout(function () { emit("USER_UPDATED", s) }, 0); return ok({ user: s.user }) }
    };
    return {
      auth: auth, rpc: rpc, storage: storage,
      from: function (t) { return new Q(t) },
      functions: { invoke: function (name, o) { return FN[name] ? FN[name](o.body || {}) : fnFail("Function not found") } },
      channel: function () { var c = { on: function (a, b, cb) { c.cb = cb; return c }, subscribe: function () { CH.push(c); return c } }; return c },
      removeChannel: function () {}
    };
  }

  // Für Tests: als andere Person handeln, Daten zurücksetzen
  window.__mg = {
    // Abfragen laufen beim Aufruf von then() – darum innerhalb des Kontexts auslösen
    as: function (email, fn) { var U = users(); return window.__mg.asId(U[email].id, fn) },
    asId: function (id, fn) { AS = id; try { var r = fn(createClient()); return r && r.then ? r.then(function (x) { return x }) : r } finally { AS = null } },
    db: function () { return db() },
    // Link aus der Passwort-Mail geöffnet
    recovery: function () { emit("PASSWORD_RECOVERY", get(SESS)) },
    maintenance: function (on) { var d = db(); d.app_status[0].maintenance = on; save(d) },
    reset: function () { localStorage.removeItem(DBK); localStorage.removeItem(USERSK); localStorage.removeItem(FILESK) }
  };
  Object.defineProperty(window, "magnumDb", { value: { createClient: createClient }, writable: false, configurable: false });
  window.MG_CONFIG = { data: "https://mock.neon.test/rest", api: "https://mock.neon.test/api" };
})();

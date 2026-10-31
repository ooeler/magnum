// Kleiner Client für das Neon-Backend: Data API (PostgREST), Login, Fotos und Function "api".
// Keine Abhängigkeit, die App liefert ihn selbst aus. Die Sitzung liegt im localStorage: Fremd-Cookies blockiert Safari.
(function () {
  if (window.magnumDb) return; // Tests und Demo bringen ihren Nachbau mit
  var KEY = "mg_sitzung", SYNC_MS = 30000;
  function createClient(cfg) {
    var S = lesen(), SUBS = [], RESET = null, CH = [];
    function lesen() { try { return JSON.parse(localStorage.getItem(KEY)) } catch (e) { return null } }
    function merken(s) { S = s; try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY) } catch (e) {} }
    function claims(t) { try { return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))) } catch (e) { return {} } }
    function sitzung(session, token) { var c = claims(token); return { session: session, token: token, exp: c.exp || 0, user: { id: c.sub, email: c.email } } }
    function melden(ev, s) { SUBS.forEach(function (cb) { cb(ev, s) }) }
    function fehler(j, r) { return { message: (j && (j.message || j.error)) || "Fehler " + r.status, code: j && j.code } }

    function api(pfad, body, kopf) {
      var h = Object.assign({ "Content-Type": "application/json" }, kopf || {});
      return fetch(cfg.api + pfad, { method: "POST", headers: h, body: JSON.stringify(body || {}) }).then(function (r) {
        return r.json().catch(function () { return null }).then(function (j) { return r.ok ? { data: j, error: null } : { data: null, error: fehler(j, r) } });
      });
    }
    // Das Token gilt 15 Minuten: kurz vor Ablauf holt die App ein neues
    function token() {
      if (!S) return Promise.resolve(null);
      if (S.exp * 1000 - Date.now() > 60000) return Promise.resolve(S.token);
      return api("/auth/token", { session: S.session }).then(function (r) {
        if (r.error) { merken(null); melden("SIGNED_OUT", null); return null }
        merken(sitzung(S.session, r.data.token)); return S.token;
      });
    }
    function mitLogin(fn) { return token().then(function (t) { return fn(t ? { Authorization: "Bearer " + t } : {}) }) }

    function Q(t) { this.t = t; this.op = "select"; this.cols = "*"; this.fl = []; this.ret = false; this.mode = null; this.body = null; this.upsertet = false }
    Q.prototype.select = function (c) { if (this.op != "select") this.ret = true; else this.cols = c || "*"; return this };
    Q.prototype.eq = function (c, v) { this.fl.push(c + "=eq." + encodeURIComponent(v)); return this };
    Q.prototype.insert = function (b) { this.op = "insert"; this.body = b; return this };
    Q.prototype.upsert = function (b) { this.op = "insert"; this.body = b; this.upsertet = true; return this };
    Q.prototype.update = function (b) { this.op = "update"; this.body = b; return this };
    Q.prototype.delete = function () { this.op = "delete"; return this };
    Q.prototype.single = function () { this.mode = "single"; return this };
    Q.prototype.maybeSingle = function () { this.mode = "maybe"; return this };
    Q.prototype.then = function (a, b) { return this.run().then(a, b) };
    Q.prototype.run = function () {
      var q = this;
      // Wartungsstand gibt es auch ohne Login
      if (q.t == "app_status") return fetch(cfg.api + "/status").then(function (r) { return r.json() }).then(function (j) { return { data: { maintenance: j.maintenance }, error: null } }).catch(function () { return { data: null, error: null } });
      return mitLogin(function (kopf) {
        var m = { select: "GET", insert: "POST", update: "PATCH", delete: "DELETE" }[q.op], pr = [];
        var par = q.fl.slice(); if (q.op == "select" || q.ret) par.push("select=" + encodeURIComponent(q.cols));
        if (q.upsertet) pr.push("resolution=merge-duplicates");
        pr.push(q.ret ? "return=representation" : "return=minimal");
        var h = Object.assign({ "Content-Type": "application/json", Prefer: pr.join(",") }, kopf);
        return fetch(cfg.data + "/" + q.t + (par.length ? "?" + par.join("&") : ""), { method: m, headers: h, body: q.body ? JSON.stringify(q.body) : undefined }).then(function (r) {
          return r.text().then(function (x) {
            var j = null; try { j = x ? JSON.parse(x) : null } catch (e) {}
            if (!r.ok) return { data: null, error: fehler(j, r) };
            if (q.mode) return { data: (j && j[0]) || null, error: q.mode == "single" && !(j && j[0]) ? { message: "Kein Eintrag gefunden" } : null };
            return { data: j, error: null };
          });
        });
      });
    };

    var auth = {
      onAuthStateChange: function (cb) {
        SUBS.push(cb);
        // Link aus der Passwort-Mail: Das Token gleich aus der Adresse entfernen
        var m = location.search.match(/[?&]token=([^&]+)/);
        setTimeout(function () {
          if (m) { RESET = decodeURIComponent(m[1]); history.replaceState(null, "", location.pathname + location.hash); cb("PASSWORD_RECOVERY", null); return }
          token().then(function () { cb("INITIAL_SESSION", S) });
        }, 0);
        return { data: { subscription: { unsubscribe: function () {} } } };
      },
      signInWithPassword: function (c) {
        return api("/auth/login", { email: c.email, password: c.password }).then(function (r) {
          if (r.error) return r;
          merken(sitzung(r.data.session, r.data.token)); melden("SIGNED_IN", S); return { data: { session: S }, error: null };
        });
      },
      signOut: function () {
        var s = S && S.session; merken(null); melden("SIGNED_OUT", null);
        return s ? api("/auth/logout", { session: s }) : Promise.resolve({ data: null, error: null });
      },
      resetPasswordForEmail: function (email) { return api("/auth/reset-request", { email: email }) },
      updateUser: function (u) {
        return api("/auth/reset", { token: RESET, password: u.password }).then(function (r) { if (!r.error) RESET = null; return r });
      }
    };

    var storage = { from: function () { return {
      upload: function (pfad, blob) {
        return mitLogin(function (kopf) {
          return fetch(cfg.api + "/fotos?pfad=" + encodeURIComponent(pfad), { method: "POST", headers: Object.assign({ "Content-Type": "image/jpeg" }, kopf), body: blob }).then(function (r) {
            return r.json().catch(function () { return null }).then(function (j) { return r.ok ? { data: j, error: null } : { data: null, error: fehler(j, r) } });
          });
        });
      },
      createSignedUrls: function (paths) {
        return mitLogin(function (kopf) { return api("/fotos/links", { paths: paths }, kopf) }).then(function (r) { return r.error ? r : { data: r.data.items, error: null } });
      }
    } } };

    // Live-Sync: Jede Änderung erhöht sync_stand, die offene App fragt regelmässig danach und nur, solange sie sichtbar ist
    var STAND = null, MAINT = null, UHR = null;
    function pruefen() {
      if (document.hidden || !CH.length) return;
      new Q("app_status").run().then(function (r) {
        var mt = r.data && r.data.maintenance;
        if (r.data && MAINT !== null && mt !== MAINT) CH.forEach(function (c) { c.cb({ table: "app_status", new: { maintenance: mt } }) });
        if (r.data) MAINT = mt;
      });
      if (!S) return;
      new Q("sync_stand").select("stand").maybeSingle().run().then(function (r) {
        var st = r.data && r.data.stand;
        if (st != null && STAND !== null && st != STAND) CH.forEach(function (c) { c.cb({ table: "*" }) });
        if (st != null) STAND = st;
      });
    }
    function channel() {
      var c = { on: function (a, b, cb) { c.cb = cb; return c }, subscribe: function () {
        CH.push(c); if (!UHR) { UHR = setInterval(pruefen, SYNC_MS); document.addEventListener("visibilitychange", pruefen); pruefen() }
        return c;
      } };
      return c;
    }

    return {
      auth: auth, storage: storage, channel: channel,
      from: function (t) { return new Q(t) },
      rpc: function (fn, a) {
        return mitLogin(function (kopf) {
          return fetch(cfg.data + "/rpc/" + fn, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, kopf), body: JSON.stringify(a || {}) }).then(function (r) {
            return r.text().then(function (x) { var j = null; try { j = x ? JSON.parse(x) : null } catch (e) {} return r.ok ? { data: j, error: null } : { data: null, error: fehler(j, r) } });
          });
        });
      },
      functions: { invoke: function (name, o) {
        return mitLogin(function (kopf) {
          return api("/" + name, o && o.body, kopf).then(function (r) {
            if (!r.error) return r;
            return { data: null, error: { message: r.error.message, context: { json: function () { return Promise.resolve({ error: r.error.message }) } } } };
          });
        });
      } }
    };
  }
  window.magnumDb = { createClient: createClient };
})();

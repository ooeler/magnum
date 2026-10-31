// Bei jeder Änderung an der App die Version erhöhen, damit Handys das Update laden (macht der Release-Workflow).
var V = "mg-v1";
var SHELL = ["./", "index.html", "config.js", "vendor/supabase.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL) }).then(function () { return self.skipWaiting() }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k != V }).map(function (k) { return caches.delete(k) }));
  }).then(function () { return self.clients.claim() }));
});

// App-Dateien: zuerst Netz (für Updates), offline aus dem Cache. Schriften: Cache zuerst.
// Anfragen an Supabase (andere Domain, auch Fotos) werden nie gecacht.
self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method != "GET") return;
  var u = new URL(r.url);
  if (u.host == "fonts.googleapis.com" || u.host == "fonts.gstatic.com") {
    e.respondWith(caches.match(r).then(function (m) {
      return m || fetch(r).then(function (res) {
        var cp = res.clone(); caches.open(V).then(function (c) { c.put(r, cp) }); return res;
      });
    }));
    return;
  }
  if (u.origin != location.origin) return;
  e.respondWith(fetch(r).then(function (res) {
    if (res.ok) { var cp = res.clone(); caches.open(V).then(function (c) { c.put(r, cp) }) }
    return res;
  }).catch(function () {
    return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || caches.match("index.html") });
  }));
});

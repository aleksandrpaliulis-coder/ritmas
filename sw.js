/* Paros ritmas — service worker.
   Programele veikia be rysio: savi failai laikomi cache, sriftai atnaujinami fone. */
var CACHE = "ritmas-20260917-162531";
var CORE = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches["delete"](k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  /* versijos zyme visada is tinklo: pagal ja programele suzino apie atnaujinima */
  if (req.url.indexOf("version.json") !== -1) {
    e.respondWith(fetch(req)["catch"](function () { return new Response("{}", { headers: { "Content-Type": "application/json" } }); }));
    return;
  }

  /* naršymas: pirma tinklas, kad atnaujinimai ateitu; be rysio — is cache */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("./index.html", copy); });
        return res;
      })["catch"](function () {
        return caches.match("./index.html").then(function (hit) { return hit || caches.match("./"); });
      })
    );
    return;
  }

  /* savi failai ir sriftai: is cache iskart, atnaujinama fone */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })["catch"](function () { return hit; });
      return hit || net;
    })
  );
});

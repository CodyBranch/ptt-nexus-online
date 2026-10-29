/*
 * The meet tablet's offline helper, for the declare pages only.
 *
 * Registered only inside the PTT Nexus Tablet app (its user agent says
 * PTTNexusTablet), never on a coach's own phone. A tablet at the coaches'
 * table loses the Wi-Fi now and then; this keeps it useful when it does:
 *
 *  - Pages, and the data they poll, come from the network first. The last
 *    good copy is kept and shown when the network is gone, and the page is
 *    told so (the "lost sync" banner).
 *  - A coach's answers (in, out, which race) made with no connection are
 *    held here, shown on the form as made, and sent in order once the
 *    connection is back. An answer is set, not added, so a held one sent
 *    late does no harm. Finalizing a race and swaps are not held: they need
 *    the meet's say at the moment they are made.
 *  - A packet scanned or marked at the packet table with no connection is
 *    held the same way: a packet picked up twice is told "already", never
 *    counted twice.
 */

const VERSION = 'kiosk-v1';
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const DB_NAME = 'nexus-kiosk';
const NET_TIMEOUT_MS = 6000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// ── The outbox ──────────────────────────────────────────────────────────────

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const allHeld = () => tx('outbox', 'readonly', (s) => s.getAll());
const dropHeld = (id) => tx('outbox', 'readwrite', (s) => s.delete(id));
const holdOne = (item) => tx('outbox', 'readwrite', (s) => s.add(item));
const getMeta = (key) => tx('meta', 'readonly', (s) => s.get(key));
const setMeta = (key, value) => tx('meta', 'readwrite', (s) => s.put(value, key));

async function tell(message) {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(message);
}

async function tellQueue() {
  const held = await allHeld();
  const refused = (await getMeta('refused')) || 0;
  await tell({ type: 'kiosk-queue', held: held.reduce((n, h) => n + (h.declarations ? h.declarations.length : 1), 0), refused });
}

/** The packet table: /api/declare/pickup/{token}. */
function pickupPath(url) {
  return /^\/api\/declare\/pickup\/[0-9a-f]{32}$/i.test(url.pathname);
}

/** A coach's form: /api/declare/{meetToken}/{teamToken}, nothing deeper. */
function formPath(url) {
  return /^\/api\/declare\/[0-9a-f]{32}\/[0-9a-f]{32}$/i.test(url.pathname);
}

let flushing = null;
async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const item of await allHeld()) {
      let res;
      try {
        res = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: item.body ?? JSON.stringify({ declarations: item.declarations }),
        });
      } catch {
        return; // still no connection: try again later, in the same order
      }
      if (res.status >= 500) return;
      const json = await res.json().catch(() => ({}));
      const refused = item.body
        ? (!res.ok || json.status === 'unknown' ? 1 : 0)
        : (!res.ok ? item.declarations.length : (json.rejected || []).length);
      if (refused) await setMeta('refused', ((await getMeta('refused')) || 0) + refused);
      await dropHeld(item.id);
    }
  })().finally(async () => {
    flushing = null;
    await tellQueue();
  });
  return flushing;
}

// ── Fetching ────────────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** The cache key for data: the dashboard's ?v= is only "what I had", not a different answer. */
function dataKey(url) {
  const u = new URL(url);
  u.searchParams.delete('v');
  return u.toString();
}

/** The held answers laid over a form's last answer, so the coach sees what they did. */
async function withHeld(url, json) {
  const held = (await allHeld()).filter((h) => h.url === url && h.declarations);
  if (!held.length || !json || !Array.isArray(json.declarations)) return json;
  const decls = json.declarations.slice();
  for (const h of held) {
    for (const d of h.declarations) {
      const i = decls.findIndex((x) => x.athleteId === d.athleteId && x.status !== 'swapped' && x.status !== 'unswapped');
      const next = { athleteId: d.athleteId, status: d.status, raceId: d.raceId ?? null };
      if (i >= 0) decls[i] = { ...decls[i], ...next };
      else decls.push(next);
    }
  }
  return { ...json, declarations: decls };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function networkFirst(request, cacheName, key, onLive) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(request), NET_TIMEOUT_MS);
    if (res.ok) await onLive(cache, res.clone());
    await tell({ type: 'kiosk-live' });
    void flush();
    return res;
  } catch {
    const hit = await cache.match(key);
    if (!hit) throw new Error('offline and nothing kept');
    const at = hit.headers.get('x-kiosk-kept-at');
    await tell({ type: 'kiosk-stale', at });
    return hit;
  }
}

async function keep(cache, key, res) {
  const body = await res.blob();
  const headers = new Headers(res.headers);
  headers.set('x-kiosk-kept-at', new Date().toISOString());
  await cache.put(key, new Response(body, { status: res.status, headers }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // A coach's answer.
  if (req.method === 'POST' && formPath(url)) {
    event.respondWith((async () => {
      const body = await req.clone().json().catch(() => null);
      const declarations = body && Array.isArray(body.declarations) && !body.swap && !body.unswap ? body.declarations : null;
      try {
        // Anything held goes first, so answers reach the meet in the order made.
        if ((await allHeld()).length) await flush();
        const res = await withTimeout(fetch(req), NET_TIMEOUT_MS);
        await tell({ type: 'kiosk-live' });
        return res;
      } catch {
        if (!declarations) throw new Error('offline');
        await holdOne({ url: req.url, declarations, at: new Date().toISOString() });
        await tellQueue();
        return jsonResponse({ held: true, rejected: [] });
      }
    })());
    return;
  }

  // A packet at the packet table.
  if (req.method === 'POST' && pickupPath(url)) {
    event.respondWith((async () => {
      const body = await req.clone().text();
      let action = null;
      try { action = JSON.parse(body).action; } catch { /* not ours to hold */ }
      try {
        if ((await allHeld()).length) await flush();
        const res = await withTimeout(fetch(req), NET_TIMEOUT_MS);
        await tell({ type: 'kiosk-live' });
        return res;
      } catch {
        // Scans and taps are held; signing and undo need the meet now.
        if (action !== 'scan' && action !== 'manual') throw new Error('offline');
        await holdOne({ url: req.url, body, at: new Date().toISOString() });
        await tellQueue();
        return jsonResponse({ held: true, status: 'waiting', message: 'Held until the tablet is back online.' });
      }
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // Next's build files never change under one name.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Logos and headshots: the kept copy at once, refreshed behind it.
  if (url.pathname.startsWith('/_next/image')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      const fresh = fetch(req).then(async (res) => { if (res.ok) await cache.put(req, res.clone()); return res; });
      return hit || fresh;
    })());
    return;
  }

  // The pages themselves.
  if (req.mode === 'navigate' && url.pathname.startsWith('/declare/')) {
    event.respondWith(networkFirst(req, PAGES, url.pathname, (cache, res) => keep(cache, url.pathname, res)));
    return;
  }

  // What they poll.
  if (url.pathname.startsWith('/api/declare/')) {
    const key = dataKey(req.url);
    event.respondWith((async () => {
      const res = await networkFirst(req, PAGES, key, async (cache, copy) => {
        const json = await copy.clone().json().catch(() => null);
        // "Nothing changed" is not a copy of the dashboard.
        if (json && json.unchanged) return;
        await keep(cache, key, copy);
      });
      if (!formPath(url)) return res;
      const json = await res.clone().json().catch(() => null);
      if (!json) return res;
      return jsonResponse(await withHeld(req.url, json), res.status);
    })());
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'kiosk-flush') event.waitUntil(flush());
  if (event.data === 'kiosk-status') event.waitUntil(tellQueue());
  if (event.data === 'kiosk-clear-refused') event.waitUntil(setMeta('refused', 0).then(tellQueue));
});

/*
 * The results page, reading Firebase instead of the laptop.
 *
 * The laptop writes its own results documents into Firebase in pieces
 * (src/main/live/firebase-publish.ts). This keeps a copy of those pieces,
 * current to the moment through Firebase's streaming REST API, and puts the
 * documents back together — the same meet, race, team, history and search
 * documents the laptop's /live/api answers with — so every view on the page
 * works unchanged and cannot tell which one it is reading.
 *
 * No Firebase SDK: an EventSource on the database's REST address is all the
 * streaming API needs, and the page stays one file plus this one.
 *
 * Also loaded by the checks under Node (module.exports), which rebuild every
 * document from a published tree and compare it with what the laptop serves.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LiveFirebase = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Keys ────────────────────────────────────────────────────────────────
  // The writer escapes . # $ [ ] / % ~ and marks all-digit keys with a
  // leading ~ (Firebase would read those back as an array). Undone here.
  function encodeKey(k) {
    const s = String(k).replace(/[%.#$[\]/~\x00-\x1f\x7f]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
    return s === "" || /^\d+$/.test(s) ? "~" + s : s;
  }
  function decodeKey(k) {
    const s = k.charAt(0) === "~" ? k.slice(1) : k;
    return s.replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  /** A value as Firebase holds it, as the laptop wrote it: keys undone, lists back as lists. */
  function decode(v) {
    if (v === null || v === undefined || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(decode);
    const keys = Object.keys(v);
    // Every object key the laptop writes is escaped, so all-digit keys can
    // only be a list that Firebase chose to hand back as an object.
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return keys.sort((a, b) => a - b).map((k) => decode(v[k])).filter((x) => x !== null && x !== undefined);
    }
    const o = {};
    for (const k of keys) o[decodeKey(k)] = decode(v[k]);
    return o;
  }
  /** The members of an object written with `i` for their order, as a list, without it. */
  function inOrder(o) {
    if (!o) return [];
    return Object.values(o).sort((a, b) => (a.i ?? 0) - (b.i ?? 0)).map((x) => { const c = Object.assign({}, x); delete c.i; return c; });
  }
  const list = (x) => (Array.isArray(x) ? x : []);
  const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

  /** A short, stable fingerprint, so a page can tell whether anything changed. */
  function fingerprint(value) {
    const s = JSON.stringify(value);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  // ── Documents, from the tree ─────────────────────────────────────────────

  /**
   * The meet document. `serverNow` is Firebase's clock as best this device
   * knows it: a live race's elapsed time is carried on from when it was
   * written, and so is the age of the lead vehicle's last fix.
   */
  function meetDoc(tree, serverNow) {
    const head = obj(tree.head);
    const meet = decode(head.meet) || {};
    const teams = inOrder(decode(head.teams));
    const clock = obj(decode(head.clock));
    const races = inOrder(decode(head.summaries)).map((s) => {
      const c = clock[s.id];
      if (!c || s.status !== "live" || c.elapsedS == null) return s;
      const stale = typeof c.at === "number" ? Math.max(0, (serverNow - c.at) / 1000) : 0;
      const out = Object.assign({}, s, { elapsedS: Math.round((c.elapsedS + stale) * 1000) / 1000 });
      if (c.gps) out.gps = Object.assign({}, c.gps, { ageS: (c.gps.ageS || 0) + stale });
      return out;
    });
    const body = {
      schema: meet.schema || 1,
      meet: {
        id: meet.id, name: meet.name || "", venue: meet.venue, date: meet.date || "",
        settings: { showLogos: !!obj(meet.settings).showLogos, showPhotos: !!obj(meet.settings).showPhotos, showRankings: obj(meet.settings).showRankings !== false },
      },
      teams,
      races,
    };
    if (body.meet.venue === undefined) delete body.meet.venue;
    // As the laptop does it: the running clock is not a change worth fetching for.
    const version = fingerprint(Object.assign({}, body, { races: races.map((r) => Object.assign({}, r, { elapsedS: undefined })) }));
    return Object.assign({ version }, body);
  }

  function standing(s) {
    const st = obj(s);
    return {
      order: list(st.order), points: obj(st.points), livePoints: obj(st.livePoints),
      teams: list(st.teams).map((t) => Object.assign({}, t, { scorers: list(t.scorers), displacers: list(t.displacers) })),
    };
  }

  function raceDoc(tree, raceId) {
    const raw = obj(tree.race)[encodeKey(raceId)];
    if (!raw || !raw.info) return null;
    const r = decode(raw);
    const info = obj(r.info);
    const teamsById = {};
    inOrder(decode(obj(tree.head).teams)).forEach((t) => { teamsById[t.id] = t; });
    const splits = obj(r.splits);
    const standings = {};
    for (const [k, s] of Object.entries(obj(r.standings))) standings[k] = standing(s);
    const race = Object.assign({}, info.race, { mats: list(obj(info.race).mats) });
    const doc = {
      schema: info.schema || 1,
      version: info.version || "",
      race,
      teams: list(info.teamIds).map((id) => teamsById[id]).filter(Boolean),
      athletes: inOrder(r.athletes).map((a) => Object.assign(a, { splits: obj(splits[a.id]) })),
      boxes: list(info.boxes),
      standings,
    };
    if (info.course) doc.course = Object.assign({}, info.course, { line: list(info.course.line) });
    if (list(info.records).length) {
      doc.records = list(info.records).map((x) => Object.assign({}, x, { splits: list(x.splits) }));
    }
    return doc;
  }

  /** A school's page, from `teamDocs/{id}` as Firebase hands it back. */
  function teamDoc(raw) {
    if (!raw) return null;
    const d = decode(raw);
    d.races = list(d.races).map((r) => Object.assign({}, r, {
      runners: list(r.runners).map((x) => (x.atMats ? Object.assign({}, x, { atMats: list(x.atMats) }) : x)),
      progress: r.progress ? list(r.progress) : undefined,
    })).map((r) => { if (r.progress === undefined) delete r.progress; return r; });
    return d;
  }

  function historyDoc(raw, raceId) {
    const d = raw ? decode(raw) : {};
    const marks = (xs) => list(xs).map((m) => (m.splits ? Object.assign({}, m, { splits: list(m.splits) }) : m));
    return Object.assign({ schema: 1, version: "", raceId, entrants: 0 }, d, {
      raceTop: marks(d.raceTop), allTimeTop: marks(d.allTimeTop), winners: marks(d.winners),
      returning: list(d.returning).map((x) => Object.assign({}, x, { history: marks(x.history) })),
    });
  }

  /**
   * One name, anywhere in the meet: the laptop's search (searchMeet), run here
   * over the index it publishes. Names, last names and schools contain the
   * words; a number is a bib and only a bib.
   */
  const SEARCH_LIMIT = 25;
  function searchDoc(index, query) {
    const q = String(query || "").trim();
    const empty = { schema: 1, query: q, athletes: [], teams: [], more: false };
    if (q.length < 2 || !index) return empty;
    const idx = decode(index) || {};
    const digits = /^\d+$/.test(q);
    const needle = q.replace(/[%_]/g, " ").toLowerCase();
    const has = (s) => String(s || "").toLowerCase().includes(needle);
    const all = Object.values(obj(idx.athletes))
      .filter((a) => digits ? String(a.bib) === q : has(a.name) || has(a.lastName) || (a.teamId && has(a.school)))
      .sort((a, b) => cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName) || (a.raceNumber - b.raceNumber));
    const athletes = all.slice(0, SEARCH_LIMIT).map((a) => {
      const o = { id: a.id, name: a.name, bib: a.bib, teamId: a.teamId, school: a.school, year: a.year, raceId: a.raceId, raceName: a.raceName };
      for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
      return o;
    });
    const teams = digits ? [] : Object.values(obj(idx.teams))
      .filter((t) => has(t.name) || has(t.shortName))
      .sort((a, b) => cmp(a.name, b.name))
      .slice(0, SEARCH_LIMIT)
      .map((t) => Object.assign({}, t, { races: list(t.races) }));
    return { schema: 1, query: q, athletes, teams, more: all.length > SEARCH_LIMIT };
  }
  // SQLite orders text by its bytes, which for the names a meet has is the
  // same as comparing code units. Not localeCompare: that would order "de la
  // Cruz" and "DeLand" differently from the laptop's list.
  function cmp(a, b) { a = String(a || ""); b = String(b || ""); return a < b ? -1 : a > b ? 1 : 0; }

  // ── Keeping a copy, live ─────────────────────────────────────────────────

  function setDeep(tree, parts, value) {
    if (!parts.length) return value === null ? {} : value;
    let at = tree;
    const trail = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!at[p] || typeof at[p] !== "object") {
        if (value === null) return tree;
        at[p] = {};
      }
      trail.push([at, p]);
      at = at[p];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete at[last]; else at[last] = value;
    // Firebase keeps no empty nodes, and neither does this.
    for (let i = trail.length - 1; i >= 0; i--) {
      const [parent, key] = trail[i];
      if (parent[key] && typeof parent[key] === "object" && !Object.keys(parent[key]).length) delete parent[key];
    }
    return tree;
  }
  const split = (path) => String(path || "").split("/").filter(Boolean);

  /**
   * A live copy of one meet in Firebase.
   *
   * `get(path)` answers the laptop's own API paths (/meet, /race/:id,
   * /team/:id, /history/:id, /search?q=) from it. `onChange(fn)` is told which
   * races moved, the way the laptop's stream tells its page.
   */
  function createSource(cfg) {
    // Keys are Firebase-safe already; in a URL they are percent-encoded once
    // more, or the %2E standing for a dot would arrive as the dot.
    const base = String(cfg.db).replace(/\/$/, "") + "/live/" + encodeURIComponent(encodeKey(cfg.meet));
    const at = (sub) => base + "/" + split(sub).map(encodeURIComponent).join("/") + ".json";
    const tree = {};
    const subs = {};

    /*
     * One WebSocket, through the Firebase library, when the page has it.
     *
     * The plain REST streams below are each an HTTP connection, and a browser
     * allows about six to one server across every tab and window - so a few
     * results pages open at once stalled the next one on "Loading". The
     * library multiplexes every listener over a single WebSocket, which that
     * limit does not count (it is how live.pttiming.com has always worked).
     * The REST streams stay as the fallback, for a page without the library
     * and for the checks, which drive this in Node against a stand-in.
     */
    const lib = cfg.sdk || (typeof firebase !== "undefined" && firebase && firebase.database ? firebase : null);
    let sdkDb = null;
    if (lib) {
      try {
        const name = "live-" + encodeKey(cfg.meet);
        const app = (lib.apps || []).find((a) => a.name === name)
          || lib.initializeApp({ databaseURL: String(cfg.db).replace(/\/$/, "") }, name);
        sdkDb = app.database();
      } catch (e) { sdkDb = null; }
    }
    const refOf = (sub) => sdkDb.ref(["live", encodeKey(cfg.meet)].concat(split(sub)).join("/"));
    const listeners = [];
    let skew = null;
    let searchIndex = null, searchAt = 0;
    const histories = {};

    function serverNow() { return Date.now() + (skew == null ? 0 : skew); }

    // Firebase stamps each clock as it lands. Arriving here a moment later,
    // the stamp is at most the real time there, so the largest offset seen is
    // the best estimate of how far this device's clock is out.
    function learnClock(data, depth) {
      if (!data || typeof data !== "object" || depth > 3) return;
      if (typeof data.at === "number" && "elapsedS" in data) {
        const est = data.at - Date.now();
        if (skew == null || est > skew) skew = est;
        return;
      }
      for (const v of Object.values(data)) learnClock(v, depth + 1);
    }

    // Gathered for a moment and told once. One change on the laptop arrives
    // as an event per value it touched — hundreds, when a field crosses a mat —
    // and each telling makes the page rebuild the race.
    let pending = null;
    function tell(races) {
      if (!pending) {
        pending = new Set();
        setTimeout(() => {
          const all = [...pending]; pending = null;
          for (const fn of listeners) { try { fn({ races: all }); } catch (e) { /* a view's problem, not the stream's */ } }
        }, 120);
      }
      for (const r of races) pending.add(r);
    }

    function apply(sub, kind, msg) {
      const at = split(sub).concat(split(msg.path));
      if (kind === "put") setDeep(tree, at, msg.data);
      else for (const [k, v] of Object.entries(msg.data || {})) setDeep(tree, at.concat(split(k)), v);
      const parts = split(sub);
      if (parts[0] === "head") learnClock(msg.data, 0);
      if (parts[0] === "race" && parts[1]) tell([decodeKey(parts[1])]);
      else tell(["~meet"]);
    }

    /**
     * Two streams at most: `head`, and the race in front of the reader. A
     * browser allows about six connections to one server, so a stream per
     * race opened (or per school looked at) stalled the page on the seventh.
     * The race left behind is let go, and fetched fresh if it is opened again.
     */
    let raceSub = null;
    function watchRace(id) {
      const sub = "race/" + encodeKey(id);
      if (raceSub && raceSub !== sub) {
        const old = subs[raceSub];
        if (old && old.es) old.es.close();
        if (old && old.off) old.off();
        delete subs[raceSub];
        setDeep(tree, split(raceSub), null);
      }
      raceSub = sub;
      return subscribe(sub);
    }

    /*
     * A stream is trusted only while it keeps talking. Firebase sends a
     * keep-alive about every thirty seconds, so one silent for longer than
     * STALE_MS has died without saying so - a phone moving from the car park's
     * signal to the venue's wifi, a network that holds streams open and
     * delivers nothing - and is opened again. And a stream that has not
     * delivered its first answer within FIRST_MS is not waited on: the answer
     * is fetched plainly, so the page loads, and the stream catches up after.
     */
    const STALE_MS = 75000, FIRST_MS = 8000;
    function stale(sub) {
      const s = subs[sub];
      return !!(s && s.es && s.es.readyState !== 2 && s.last && Date.now() - s.last > STALE_MS);
    }
    function reopen(sub) {
      const s = subs[sub];
      if (s && s.es) s.es.close();
      if (s && s.off) s.off();
      delete subs[sub];
      return subscribe(sub);
    }
    function subscribe(sub) {
      const have = subs[sub];
      if (have && have.off) return have.ready;
      if (have && have.es && have.es.readyState !== 2) return have.ready;
      if (sdkDb) {
        // The library keeps the socket up and resyncs after a drop itself, so
        // none of the staleness handling below is needed for it.
        const s = { es: null, off: null, ready: null, last: Date.now() };
        s.ready = new Promise((resolve, reject) => {
          let first = true;
          const ref = refOf(sub);
          const cb = (snap) => {
            s.last = Date.now();
            apply(sub, "put", { path: "/", data: snap.val() });
            if (first) { first = false; resolve(); }
          };
          ref.on("value", cb, () => { if (first) { first = false; reject(notOn()); } });
          s.off = () => ref.off("value", cb);
        });
        s.ready.catch(() => {});
        subs[sub] = s;
        return s.ready;
      }
      const s = { es: null, ready: null, failed: null, last: Date.now() };
      s.ready = new Promise((resolve, reject) => {
        const es = new EventSource(at(sub));
        s.es = es;
        let first = true;
        const on = (kind) => (e) => {
          s.last = Date.now();
          let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
          apply(sub, kind, msg);
          if (first) { first = false; resolve(); }
        };
        es.addEventListener("put", on("put"));
        es.addEventListener("patch", on("patch"));
        es.addEventListener("keep-alive", () => { s.last = Date.now(); });
        setTimeout(() => {
          if (!first) return;
          getOnce(sub).then((data) => {
            if (!first) return;
            first = false;
            apply(sub, "put", { path: "/", data });
            resolve();
          }).catch((err) => { if (first) { first = false; reject(err); } });
        }, FIRST_MS);
        // Firebase ends a stream it will no longer serve: the meet was
        // switched off, or the rules changed. Try again later from scratch.
        es.addEventListener("cancel", () => { es.close(); if (first) reject(notOn()); });
        es.addEventListener("auth_revoked", () => { es.close(); });
        es.onerror = () => { if (es.readyState === 2 && first) reject(unreachable()); };
      });
      s.ready.catch(() => {});
      subs[sub] = s;
      return s.ready;
    }

    /*
     * A tab nobody is looking at lets its streams go. The two-stream cap above
     * is per tab, and the browser's six connections to one server are shared
     * by all of them: with three results tabs open, a fourth sat on "Loading
     * the schedule..." because every connection it could use was held by a
     * tab in the background. After PARK_MS hidden, this tab closes its
     * streams and keeps what it has; shown again, it opens them, and each
     * one's first message is the whole of what it covers, so nothing that
     * changed meanwhile is missed.
     */
    const PARK_MS = cfg.parkMs || 10000;
    let parkTimer = null;
    let parked = false;
    function park() {
      parked = true;
      // The library's socket is one connection however many tabs there are,
      // so a hidden tab only goes offline; its listeners stay and catch up.
      if (sdkDb) { sdkDb.goOffline(); return; }
      for (const k of Object.keys(subs)) {
        const s = subs[k];
        if (s && s.es) s.es.close();
        delete subs[k];
      }
    }
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", () => {
        clearTimeout(parkTimer);
        if (document.hidden) { parkTimer = setTimeout(park, PARK_MS); return; }
        if (sdkDb) {
          sdkDb.goOnline();
          // Back online is not the same as being told again. A tab brought
          // back after a while in the background sat on what it had until it
          // was reloaded (Joe Piane); its listeners are made afresh, and a
          // fresh listener's first answer is the whole of what it covers.
          if (parked && opened) resubscribe();
          parked = false;
          return;
        }
        parked = false;
        if (!opened) return;
        subscribe("head");
        if (raceSub) subscribe(raceSub);
      });
    }

    /** Every listener dropped and made again, so each reads the current state afresh. */
    function resubscribe() {
      for (const k of Object.keys(subs)) {
        const s = subs[k];
        if (s && s.off) s.off();
        if (s && s.es) s.es.close();
        delete subs[k];
      }
      subscribe("head");
      if (raceSub) subscribe(raceSub);
    }

    /*
     * While a race is running, Firebase is written every couple of seconds -
     * its clock, at the least - and the head of the meet hears every one. A
     * visible page that has heard nothing for LIVE_SILENT_MS while a race is
     * live has listeners that stopped without saying so, and they are made
     * again. The page asks for the meet every few seconds, which is what runs
     * this.
     */
    const LIVE_SILENT_MS = cfg.liveSilentMs || 20000;
    let lastResubscribe = 0;
    function liveSilent() {
      if (!sdkDb || typeof document === "undefined" || document.hidden) return false;
      const head = subs.head;
      if (!head || !head.last || Date.now() - head.last < LIVE_SILENT_MS) return false;
      if (Date.now() - lastResubscribe < LIVE_SILENT_MS) return false;
      const sums = obj(obj(tree.head).summaries);
      return Object.values(sums).some((r) => r && r.status === "live");
    }

    function notOn() { const e = new Error("Live results are not switched on for this meet."); e.status = 404; return e; }
    function unreachable() { return new Error("The results could not be reached."); }

    async function getOnce(path) {
      if (sdkDb) {
        try {
          const snap = await refOf(path).get();
          return snap.val();
        } catch (e) {
          throw /permission/i.test(String(e && e.message)) ? notOn() : unreachable();
        }
      }
      const res = await fetch(at(path));
      if (res.status === 401 || res.status === 403) throw notOn();
      if (!res.ok) throw unreachable();
      return res.json();
    }

    let opened = null;
    async function open() {
      if (opened) return opened;
      opened = (async () => {
        // One plain read first, so "switched off" and "no such meet" are said
        // as themselves rather than as a stream that never starts.
        const meet = await getOnce("head/meet");
        if (!meet) { const e = new Error("There are no live results for this meet yet."); e.status = 404; throw e; }
        if (meet.published !== true) throw notOn();
        await subscribe("head");
      })();
      try { await opened; } catch (e) { opened = null; throw e; }
    }

    async function get(path) {
      await open();
      // A stream Firebase closed (switched off, then on again) is opened again
      // here, and so is one that has gone quiet.
      if (stale("head")) reopen("head");
      if (raceSub && stale(raceSub)) reopen(raceSub);
      if (liveSilent()) { lastResubscribe = Date.now(); resubscribe(); }
      await subscribe("head");
      const [p, q] = String(path).split("?");
      const parts = split(p).map(decodeURIComponent);
      if (parts[0] === "meet") {
        if (obj(obj(tree.head).meet).published !== true) throw notOn();
        return meetDoc(tree, serverNow());
      }
      if (parts[0] === "race") {
        await watchRace(parts[1]);
        const d = raceDoc(tree, parts[1]);
        if (!d) { const e = new Error("That race is not in the results."); e.status = 404; throw e; }
        return d;
      }
      if (parts[0] === "team") {
        // Read, not watched: the page asks again every few seconds while one
        // of the school's races is running.
        const d = teamDoc(await getOnce("teamDocs/" + encodeKey(parts[1])));
        if (!d) { const e = new Error("That school is not in the results."); e.status = 404; throw e; }
        return d;
      }
      if (parts[0] === "history") {
        const id = parts[1];
        if (!histories[id]) histories[id] = getOnce("history/" + encodeKey(id)).catch(() => null);
        return historyDoc(await histories[id], id);
      }
      if (parts[0] === "search") {
        // Downloaded once somebody searches, and refreshed now and then: a
        // runner added at the tent should be findable at the tent.
        if (!searchIndex || Date.now() - searchAt > 60000) {
          searchAt = Date.now();
          searchIndex = getOnce("search").catch(() => searchIndex);
        }
        const qs = new URLSearchParams(q || "");
        return searchDoc(await searchIndex, qs.get("q"));
      }
      const e = new Error("Not found"); e.status = 404; throw e;
    }

    return {
      get,
      onChange(fn) { listeners.push(fn); },
      serverNow,
      /** For the checks: the copy as it stands. */
      tree,
    };
  }

  return { encodeKey, decodeKey, decode, meetDoc, raceDoc, teamDoc, historyDoc, searchDoc, createSource, setDeep };
});

/*
 * ZILL : rules engine, line-for-line port of engine/zill_engine.py
 * SYNTHETIC DATA ONLY. All stations, routes, groups and timings are fictional.
 * Nothing here is connected to any real Hajj system, map or authority data.
 *
 * No AI, no learning, no scoring model: every suggestion comes from fixed rules,
 * so every suggestion can be explained.
 *
 * Parity: the 7 scripted scenarios (js/scenarios.js) reproduce the exact
 * detail strings produced by engine/run_scenarios.py.
 */
(function (global) {
  "use strict";

  // ---- Operating assumptions (to be validated with operators) ---------------
  const FRESH_MIN = 10;          // updated within 10 min -> shown as live
  const STALE_MIN = 20;          // older than 20 min -> not offered; manual prompt
  const REQUEST_TIMEOUT_MIN = 3; // station must answer within 3 min or request lapses
  const NO_SHOW_GRACE_MIN = 15;  // accepted hold released 15 min after stated ETA
  const WALK_M_PER_MIN = 50;     // conservative group walking pace (assumption)

  // Python's round() uses banker's rounding; keep parity.
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  // Whole minutes for text (identical to Python when the clock is an integer).
  const wm = (x) => (Number.isInteger(x) ? x : Math.floor(x + 1e-9));

  class Station {
    constructor(id, name, node, o) {
      this.id = id; this.name = name; this.node = node;
      this.capacity = o.capacity; this.occupancy = o.occupancy;
      this.services = new Set(o.services); this.step_free = o.step_free;
      this.status = o.status || "open";          // open | paused | closed
      this.updated_at = o.updated_at || 0;       // minute of last staff update
      this.holds = {};                           // rid -> [size, expires_at, kind]
    }
    held(now) { let t = 0; for (const k in this.holds) { const h = this.holds[k]; if (h[1] > now) t += h[0]; } return t; }
    free(now) { return this.capacity - this.occupancy - this.held(now); }
    age(now) { return now - this.updated_at; }
  }

  class Edge {
    constructor(a, b, metres, o) {
      o = o || {};
      this.a = a; this.b = b; this.metres = metres;
      this.status = o.status || "approved";      // approved | closed | unverified
      this.step_free = o.step_free === undefined ? true : o.step_free;
    }
  }

  class Group {
    constructor(id, size, node, needs_step_free, needs) {
      this.id = id; this.size = size; this.node = node;
      this.needs_step_free = !!needs_step_free; this.needs = new Set(needs || ["cooling"]);
    }
  }

  const subset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };

  class Zill {
    constructor(stations, edges) {
      this.st = {}; for (const s of stations) this.st[s.id] = s;
      this.edges = edges;
      this.log = [];          // [now, ref, text]
      this._req = 0;
      this.requests = {};
      this.overrides = [];    // mirror of OVERRIDE log entries, for the supervisor view
    }

    // -- routing: only approved, open segments; step-free if the group needs it
    _adj(step_free) {
      const adj = {};
      for (const e of this.edges) {
        if (e.status !== "approved") continue;
        if (step_free && !e.step_free) continue;
        (adj[e.a] = adj[e.a] || []).push([e.b, e.metres]);
        (adj[e.b] = adj[e.b] || []).push([e.a, e.metres]);
      }
      return adj;
    }
    walk(src, dst, step_free) { const r = this.walkPath(src, dst, step_free); return r ? r.metres : null; }
    walkPath(src, dst, step_free) {
      const adj = this._adj(step_free);
      const dist = {}, prev = {}, pq = [[0, src]];
      dist[src] = 0;
      while (pq.length) {
        pq.sort((x, y) => x[0] - y[0]);
        const top = pq.shift(), d = top[0], n = top[1];
        if (n === dst) {
          const path = [n]; let c = n;
          while (prev[c] !== undefined) { c = prev[c]; path.unshift(c); }
          return { metres: d, path: path };
        }
        if (d > (dist[n] === undefined ? 1e18 : dist[n])) continue;
        for (const mw of adj[n] || []) {
          const m = mw[0], w = mw[1];
          if (d + w < (dist[m] === undefined ? 1e18 : dist[m])) { dist[m] = d + w; prev[m] = n; pq.push([d + w, m]); }
        }
      }
      return null;
    }

    expire(now) {
      for (const s of Object.values(this.st)) {
        for (const rid of Object.keys(s.holds).filter((r) => s.holds[r][1] <= now)) {
          const kind = s.holds[rid][2];
          delete s.holds[rid];
          const req = this.requests[rid];
          if (req && (req.state === "pending" || req.state === "accepted")) {
            req.state = kind === "pending" ? "lapsed" : "no-show";
            req.closed_at = now;
            this.log.push([now, rid, req.state]);
          }
        }
      }
    }

    /** Returns {feasible, excluded:[[id, why]], manual}. Same order of checks as Python. */
    options(g, now) {
      this.expire(now);
      const feasible = [], excluded = [];
      for (const s of Object.values(this.st)) {
        let why = null;
        if (s.status !== "open") why = "" + s.status;
        else if (s.age(now) > STALE_MIN) why = "info " + wm(s.age(now)) + " min old — confirm by radio";
        else if (!subset(g.needs, s.services)) why = "service not offered";
        else if (g.needs_step_free && !s.step_free) why = "no step-free entry";
        else if (s.free(now) < g.size) why = "space " + Math.max(s.free(now), 0) + " < group " + g.size + " (not split)";
        else {
          const m = this.walk(g.node, s.node, g.needs_step_free);
          if (m === null) why = "no approved" + (g.needs_step_free ? " step-free" : "") + " route";
          else feasible.push({
            station: s.id, metres: m, walk_min: pyRound(m / WALK_M_PER_MIN),
            free: s.free(now), updated_min_ago: s.age(now),
            why: s.free(now) + " places, " + m + " m on approved route, updated " + wm(s.age(now)) + " min ago",
          });
        }
        if (why) excluded.push([s.id, why]);
      }
      feasible.sort((a, b) => a.metres - b.metres || a.updated_min_ago - b.updated_min_ago || b.free - a.free);
      return { feasible: feasible, excluded: excluded, manual: feasible.length === 0 };
    }

    /** UI only: evaluate every rule (not short-circuit) so a screen can show the full checklist. */
    explain(g, now, sid) {
      const s = this.st[sid];
      const route = this.walkPath(g.node, s.node, g.needs_step_free);
      const missing = [...g.needs].filter((x) => !s.services.has(x));
      return [
        { rule: "Station open", ok: s.status === "open", note: s.status },
        { rule: "Data no older than " + STALE_MIN + " min", ok: s.age(now) <= STALE_MIN, note: "updated " + wm(s.age(now)) + " min ago" },
        { rule: "Offers the services needed", ok: missing.length === 0, note: missing.length ? "missing: " + missing.join(", ") : [...g.needs].join(" + ") },
        { rule: "Step-free entry (if needed)", ok: !g.needs_step_free || s.step_free, note: g.needs_step_free ? (s.step_free ? "step-free entry" : "no step-free entry") : "not needed" },
        { rule: "Whole group fits, never split", ok: s.free(now) >= g.size, note: Math.max(s.free(now), 0) + " free for " + g.size + " people" },
        { rule: "Approved" + (g.needs_step_free ? " step-free" : "") + " route", ok: !!route, note: route ? route.metres + " m via " + route.path.join("→") : "no open route" },
      ];
    }

    request(g, station_id, now, eta_min) {
      this.expire(now);
      const s = this.st[station_id];
      if (s.status !== "open" || s.free(now) < g.size) {
        this.log.push([now, g.id, "request to " + station_id + " refused: no space"]);
        return null;
      }
      this._req += 1;
      const rid = "R" + this._req;
      s.holds[rid] = [g.size, now + REQUEST_TIMEOUT_MIN, "pending"];
      this.requests[rid] = {
        group: g.id, station: station_id, size: g.size, state: "pending", eta: now + eta_min,
        // display-only fields (not used by any rule)
        sent: now, node: g.node, step_free: g.needs_step_free, needs: [...g.needs],
      };
      this.log.push([now, rid, "pending at " + station_id + " for " + g.id + " (" + g.size + ")"]);
      return rid;
    }

    respond(rid, decision, now, reason) {
      reason = reason || "";
      this.expire(now);
      const req = this.requests[rid];
      const s = this.st[req.station];
      if (req.state !== "pending") return req.state;
      if (decision === "accept") {
        s.holds[rid] = [req.size, req.eta + NO_SHOW_GRACE_MIN, "accepted"];
        req.state = "accepted";
      } else { // decline | coordinate
        delete s.holds[rid];
        req.state = decision;
        req.closed_at = now;
      }
      req.answered_at = now;
      this.log.push([now, rid, (req.state + " " + reason).trim()]);
      return req.state;
    }

    arrive(rid, now) {
      const req = this.requests[rid];
      const s = this.st[req.station];
      delete s.holds[rid];
      s.occupancy += req.size;
      s.updated_at = now;
      req.state = "arrived"; req.closed_at = now;
      this.log.push([now, rid, "arrived"]);
    }

    staff_update(station_id, now, occupancy, status) {
      const s = this.st[station_id];
      if (occupancy !== undefined && occupancy !== null) s.occupancy = occupancy;
      if (status !== undefined && status !== null) {
        s.status = status;
        if (status !== "open") {
          for (const rid of Object.keys(s.holds)) {
            const st = this.requests[rid].state;
            if (st === "pending" || st === "accepted") {
              this.requests[rid].state = "station-closed"; this.requests[rid].closed_at = now;
              this.log.push([now, rid, "station closed — coordinator re-plans"]);
            }
          }
          s.holds = {};
        }
      }
      s.updated_at = now;
    }

    override(who, rid_or_group, action, reason, now) {
      if (!reason) throw new Error("override needs a recorded reason");
      this.log.push([now, rid_or_group, "OVERRIDE by " + who + ": " + action + " — " + reason]);
      this.overrides.push({ now: now, ref: rid_or_group, who: who, action: action, reason: reason });
    }

    // ---- serialisation (live state shared between windows) -------------------
    toJSON() {
      return {
        st: Object.values(this.st).map((s) => Object.assign({}, s, { services: [...s.services] })),
        edges: this.edges.map((e) => Object.assign({}, e)), log: this.log, _req: this._req,
        requests: this.requests, overrides: this.overrides,
      };
    }
    static fromJSON(o) {
      o = JSON.parse(JSON.stringify(o));
      const z = new Zill(
        o.st.map((s) => { const x = new Station(s.id, s.name, s.node, s); x.holds = s.holds; x.status = s.status; x.updated_at = s.updated_at; return x; }),
        o.edges.map((e) => new Edge(e.a, e.b, e.metres, e)));
      z.log = o.log; z._req = o._req; z.requests = o.requests; z.overrides = o.overrides || [];
      return z;
    }
  }

  // ---- Synthetic demo area (matches design/mockups.html) ---------------------
  function demo_area() {
    const stations = [
      new Station("S1", "Station 1 (synthetic)", "A", { capacity: 60, occupancy: 58, services: ["cooling", "water", "rest"], step_free: true, updated_at: 0 }),
      new Station("S2", "Station 2 (synthetic)", "C", { capacity: 80, occupancy: 40, services: ["cooling", "water", "rest"], step_free: true, updated_at: 0 }),
      new Station("S3", "Station 3 (synthetic)", "D", { capacity: 50, occupancy: 20, services: ["cooling", "water", "rest", "wheelchair-seating"], step_free: true, updated_at: 0 }),
      new Station("S4", "Station 4 (synthetic)", "E", { capacity: 100, occupancy: 30, services: ["cooling", "water"], step_free: true, updated_at: -30 }), // stale
      new Station("S5", "Station 5 (synthetic)", "F", { capacity: 70, occupancy: 35, services: ["cooling", "water", "rest"], step_free: true, updated_at: 0 }),
    ];
    const edges = [
      new Edge("G", "A", 150), new Edge("A", "B", 200),
      new Edge("B", "C", 150, { step_free: false }),     // stairs: not wheelchair-accessible
      new Edge("B", "D", 350), new Edge("G", "E", 300),
      new Edge("G", "F", 250, { status: "closed" }),     // closed route
      new Edge("E", "F", 500), new Edge("D", "F", 300),
    ];
    return [stations, edges];
  }

  global.ZillEngine = {
    FRESH_MIN: FRESH_MIN, STALE_MIN: STALE_MIN, REQUEST_TIMEOUT_MIN: REQUEST_TIMEOUT_MIN,
    NO_SHOW_GRACE_MIN: NO_SHOW_GRACE_MIN, WALK_M_PER_MIN: WALK_M_PER_MIN,
    Station: Station, Edge: Edge, Group: Group, Zill: Zill, demo_area: demo_area, pyRound: pyRound, wm: wm,
  };
})(typeof window !== "undefined" ? window : globalThis);
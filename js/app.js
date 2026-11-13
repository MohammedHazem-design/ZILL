/*
 * ZILL prototype UI: one app, three role screens sharing one live state.
 * Coordinator (phone) . Station staff (tablet) . Supervisor (desktop) . Scenario Lab . Evidence
 * Synthetic data only. Schematic, fictional layout; not a real Hajj map.
 */
(function () {
  "use strict";
  const E = window.ZillEngine, SC = window.ZillScenarios;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const pad = (n) => String(n).padStart(2, "0");
  const wm = E.wm;
  const AR = '<span class="ar" lang="ar" dir="rtl">&#x638;&#x644;</span>';
  const BASE = 14 * 60; // simulated clock: minute 0 = 14:00
  const clock = (now) => { const t = BASE + Math.floor(now + 1e-9); return pad(Math.floor(t / 60) % 24) + ":" + pad(((t % 60) + 60) % 60); };
  const cd = (mins) => { const s = Math.max(0, Math.ceil(mins * 60 - 1e-6)); return Math.floor(s / 60) + ":" + pad(s % 60); };
  const SVC = { cooling: "Cooling", water: "Water", rest: "Rest", "wheelchair-seating": "Wheelchair seats" };
  const svcList = (s) => [...s.services].map((x) => SVC[x] || x).join(" &middot; ");
  const NODES = { G: [150, 520], A: [330, 400], B: [560, 300], C: [760, 170], D: [900, 300], E: [470, 590], F: [940, 560] };
  const LOCS = { G: "Assembly point G", B: "Junction B", E: "Near S4 (point E)" };
  const STATE_TXT = { pending: "Awaiting answer", accepted: "On the way", declined: "Declined", coordinate: "Call me", lapsed: "Lapsed (no reply)", "no-show": "Hold released", arrived: "Arrived", "station-closed": "Station closed" };
  // phase-lock CSS animations to wall time so re-created SVG elements continue smoothly
  const ph = (d) => ' data-ph="' + d + '"';
  function phase(el) { const t = performance.now() / 1000; el.querySelectorAll('[data-ph]').forEach((n) => { n.style.animationDelay = '-' + (t % +n.dataset.ph).toFixed(3) + 's'; }); }
  // only touch the DOM when the markup actually changed
  function setHTML(el, html) { if (el._h === html) return false; el._h = html; el.innerHTML = html; phase(el); return true; }
  function fresh(age) {
    if (age <= E.FRESH_MIN) return { cls: "fresh", tag: "Live", txt: "updated " + wm(age) + " min ago" };
    if (age <= E.STALE_MIN) return { cls: "ageing", tag: "Ageing", txt: "updated " + wm(age) + " min ago" };
    return { cls: "stale", tag: "Not live", txt: "data " + wm(age) + " min old" };
  }

  // ------------------------------------------------------------------ state
  const params = new URLSearchParams(location.search);
  const KIOSK = params.get("device"); // coord | station | super | map  (open on a second screen)
  const S = {
    eng: null, now: 5, running: false, speed: 30,
    mode: KIOSK ? "ops" : "intro", layout: KIOSK || "all",
    offline: false, offlineSnap: null, offlineAt: null,
    coord: { size: 25, node: "G", stepFree: false, rest: false, water: false, wheel: false, selected: null, id: null },
    stationId: params.get("station") || "S2",
    focus: null, highlight: null, dismissed: {}, prev: {}, toasts: { coord: [], station: [] }, toastOn: true,
    lab: { idx: 0, step: -1, playing: false, playAll: false, results: {}, ctx: null, timer: null },
    tour: { step: 0, timer: null },
  };
  function resetLive() {
    const a = E.demo_area(); S.eng = new E.Zill(a[0], a[1]); S.now = 5; S.dismissed = {}; S.prev = {};
    S.coord = { size: 25, node: "G", stepFree: false, rest: false, water: false, wheel: false, selected: null, id: null };
    S.offline = false; S.offlineSnap = null; S.highlight = null; S.focus = null; S.toasts = { coord: [], station: [] };
  }
  resetLive();

  // ------------------------------------------------------- live sync (multi-window)
  const TAB = Math.random().toString(36).slice(2);
  let chan = null; try { chan = new BroadcastChannel("zill-live-v1"); } catch (e) { chan = null; }
  let lastSent = 0;
  function broadcast(force) {
    if (!chan) return;
    const t = Date.now(); if (!force && t - lastSent < 900) return; lastSent = t;
    try { chan.postMessage({ from: TAB, eng: S.eng.toJSON(), now: S.now, stationId: S.stationId, coord: S.coord, offline: S.offline }); } catch (e) { /* ignore */ }
  }
  if (chan) chan.onmessage = (ev) => {
    const m = ev.data; if (!m || m.from === TAB) return;
    if (m.hello) { if (!KIOSK) broadcast(true); return; }
    S.eng = E.Zill.fromJSON(m.eng); S.now = m.now; S.coord = m.coord;
    if (!params.get("station")) S.stationId = m.stationId;
    render();
  };
  function commit() { broadcast(true); render(); }

  // ------------------------------------------------------------------ helpers
  function coordEngine() {
    if (S.offline && S.offlineSnap) return E.Zill.fromJSON(S.offlineSnap);
    return S.eng;
  }
  function needsList(d) { const n = ["cooling"]; if (d.rest) n.push("rest"); if (d.water) n.push("water"); if (d.wheel) n.push("wheelchair-seating"); return n; }
  function nextGroupId(size) {
    const used = new Set(Object.values(S.eng.requests).map((r) => r.group));
    let id = "G-" + size, k = 1; const L = "bcdefghijklmnopqrstuvwxyz";
    while (used.has(id) && k < 26) { id = "G-" + size + L[k - 1]; k++; }
    return id;
  }
  function draftGroup() {
    const d = S.coord; const id = d.id || nextGroupId(d.size);
    return new E.Group(id, d.size, d.node, d.stepFree, needsList(d));
  }
  function toast(where, html, kind) {
    if (!S.toastOn) return;
    const t = { id: Math.random(), html: html, kind: kind || "info", at: Date.now() };
    S.toasts[where].unshift(t); S.toasts[where] = S.toasts[where].slice(0, 3);
    setTimeout(() => { S.toasts[where] = S.toasts[where].filter((x) => x !== t); render(); }, 5200);
  }
  function diffStates() {
    for (const rid in S.eng.requests) {
      const r = S.eng.requests[rid], was = S.prev[rid];
      if (was === r.state) continue;
      S.prev[rid] = r.state;
      if (was === undefined && r.state !== "pending") continue;
      const who = "<b>" + esc(r.group) + "</b> → <b>" + r.station + "</b>";
      if (r.state === "pending") toast("station", "New arrival request: " + who + " &middot; " + r.size + " people", "amber");
      else if (r.state === "accepted") toast("coord", "&#x2713; " + r.station + " confirmed " + esc(r.group) + ". Walk now.", "ok");
      else if (r.state === "declined") toast("coord", r.station + " declined " + esc(r.group) + ". Choose another station.", "warn");
      else if (r.state === "coordinate") toast("coord", r.station + " asks you to call them about " + esc(r.group) + ".", "warn");
      else if (r.state === "lapsed") toast("coord", "No reply from " + r.station + " in 3 min. Request lapsed; re-plan.", "warn");
      else if (r.state === "station-closed") toast("coord", r.station + " closed. Hold for " + esc(r.group) + " cancelled; re-plan.", "bad");
      else if (r.state === "no-show") toast("station", esc(r.group) + " did not arrive. Hold released.", "warn");
      else if (r.state === "arrived") toast("coord", esc(r.group) + " arrived at " + r.station + ".", "ok");
    }
  }

  // ------------------------------------------------------------------ map
  function mapSVG(o) {
    const z = o.z, now = o.now, mini = !!o.mini;
    const fs = mini ? 34 : 19;
    let h = '<svg viewBox="0 0 1100 720" class="map' + (mini ? " mini" : "") + '" role="img" aria-label="Schematic, fictional layout. Not a real Hajj map.">';
    h += '<defs><pattern id="dots' + (mini ? "m" : "") + '" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#1d4a52"/></pattern>' +
      '<filter id="glow"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    h += '<rect width="1100" height="720" rx="28" fill="#0a1f24"/><rect width="1100" height="720" rx="28" fill="url(#dots' + (mini ? "m" : "") + ')"/>';
    h += '<text x="32" y="' + (mini ? 60 : 44) + '" font-size="' + (mini ? 30 : 17) + '" fill="#7fb7bf" letter-spacing="2">SCHEMATIC &#183; FICTIONAL &#183; NOT A REAL HAJJ MAP</text>';
    for (const e of z.edges) {
      const p = NODES[e.a], q = NODES[e.b];
      let cls = "e-ok"; if (e.status === "closed") cls = "e-closed"; else if (e.status !== "approved") cls = "e-unv"; else if (!e.step_free) cls = "e-stairs";
      h += '<line class="edge ' + cls + '" x1="' + p[0] + '" y1="' + p[1] + '" x2="' + q[0] + '" y2="' + q[1] + '"/>';
      if (!mini) {
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        if (e.status === "approved") h += '<text class="mlabel" x="' + mx + '" y="' + (my - 12) + '" text-anchor="middle">' + e.metres + ' m</text>';
      }
    }
    for (const e of z.edges) {
      const p = NODES[e.a], q = NODES[e.b], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      if (e.status === "closed") h += '<text x="' + (e.a === "G" && e.b === "F" ? 700 : mx) + '" y="' + (e.a === "G" && e.b === "F" ? (mini ? 600 : 532) : my - 14) + '" font-size="' + fs + '" fill="#E0603F" font-weight="700" text-anchor="middle">route closed</text>';
      else if (e.status === "unverified") h += '<text x="' + mx + '" y="' + (my + 30) + '" font-size="' + fs + '" fill="#9fb9b7" font-weight="700" text-anchor="middle">unverified</text>';
      else if (!e.step_free && !mini) h += '<text x="600" y="212" text-anchor="end" font-size="' + fs + '" fill="#F2B45A" font-weight="700">stairs &#8212; not step-free</text>';
    }
    for (const rid in z.requests) {
      const r = z.requests[rid]; if (r.state !== "pending") continue;
      const st = z.st[r.station], wp = z.walkPath(r.node, st.node, r.step_free); if (!wp) continue;
      h += '<polyline class="e-pending"' + ph(1.6) + ' points="' + wp.path.map((n) => NODES[n].join(",")).join(" ") + '"/>';
    }
    if (o.route && o.route.length > 1) {
      const pts = o.route.map((n) => NODES[n].join(",")).join(" ");
      h += '<polyline class="e-route-glow" points="' + pts + '"/><polyline class="e-route"' + ph(1.2) + ' points="' + pts + '"/>';
    }
    h += '<circle cx="560" cy="300" r="9" fill="#3d7480"/>' + (mini ? "" : '<text x="560" y="335" text-anchor="middle" class="mlabel">B</text>');
    const LBL = { S1: [48, 52, "start"], S2: [48, 8, "start"], S3: [0, 68, "middle"], S4: [0, 66, "middle"], S5: [0, 66, "middle"] };
    for (const s of Object.values(z.st)) {
      const xy = NODES[s.node], f = fresh(s.age(now));
      let ring = "#7fd1c7", sub = "", subc = "#9fb9b7";
      const free = s.free(now);
      if (s.status !== "open") { ring = s.status === "closed" ? "#E0603F" : "#F2B45A"; sub = s.status.toUpperCase(); subc = ring; }
      else if (f.cls === "stale") { ring = "#F2B45A"; sub = "NOT LIVE · " + wm(s.age(now)) + " min old"; subc = ring; }
      else { sub = Math.max(free, 0) + " free / " + s.capacity; if (free <= 5) { ring = "#E0603F"; subc = ring; sub += " · near full"; } }
      const hl = o.highlight === s.id || o.selected === s.id;
      if (hl) h += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="50" fill="none" stroke="#00E4FF" stroke-width="3" class="pulse"' + ph(1.8) + '/>';
      const pend = Object.values(z.requests).some((r) => r.station === s.id && r.state === "pending");
      if (pend) h += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="44" fill="none" stroke="#F2B45A" stroke-width="3" stroke-dasharray="6 6" class="spin"' + ph(6) + '/>';
      h += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="34" fill="' + (o.selected === s.id ? "#0B4148" : "#06161a") + '" stroke="' + ring + '" stroke-width="5"/>';
      h += '<text x="' + xy[0] + '" y="' + (xy[1] + 8) + '" font-size="24" fill="#fff" text-anchor="middle" font-weight="700">' + s.id + '</text>';
      if (!mini) {
        const l = LBL[s.id];
        h += '<text x="' + (xy[0] + l[0]) + '" y="' + (xy[1] + l[1]) + '" font-size="18" fill="' + subc + '" text-anchor="' + l[2] + '" font-weight="700">' + sub + '</text>';
        if (s.services.has("wheelchair-seating")) h += '<text x="' + (xy[0] + l[0]) + '" y="' + (xy[1] + l[1] + 22) + '" font-size="15" fill="#86E0D0" text-anchor="' + l[2] + '">wheelchair seats</text>';
      } else if (s.status !== "open" || f.cls === "stale") {
        h += '<text x="' + xy[0] + '" y="' + (xy[1] + 72) + '" font-size="28" fill="' + subc + '" text-anchor="middle" font-weight="700">' + (s.status !== "open" ? s.status : "not live") + '</text>';
      }
    }
    for (const rid in z.requests) {
      const r = z.requests[rid]; if (r.state !== "accepted") continue;
      const st = z.st[r.station], wp = z.walkPath(r.node, st.node, r.step_free);
      const pts = wp ? wp.path.map((n) => NODES[n]) : [NODES[r.node], NODES[st.node]];
      const span = Math.max(0.01, r.eta - r.sent), p = Math.max(0, Math.min(1, (now - r.sent) / span));
      let tot = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(L); tot += L; }
      let d = p * tot, x = pts[0][0], y = pts[0][1];
      for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const t = seg[i] ? d / seg[i] : 0; x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t; y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t; break; } d -= seg[i]; x = pts[i + 1][0]; y = pts[i + 1][1]; }
      const late = now > r.eta;
      h += '<g class="mover"><circle cx="' + x + '" cy="' + y + '" r="' + (mini ? 22 : 15) + '" fill="' + (late ? "#F2B45A" : "#00E4FF") + '" filter="url(#glow)"/>' +
        (mini ? "" : '<text x="' + x + '" y="' + (y - 24) + '" font-size="16" fill="' + (late ? "#F2B45A" : "#00E4FF") + '" text-anchor="middle" font-weight="700">' + esc(r.group) + (late ? " · overdue" : " · on the way") + '</text>') + '</g>';
    }
    if (o.group) {
      const xy = NODES[o.group.node];
      h += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="54" fill="#00E4FF" opacity=".16" class="breathe"' + ph(2.6) + '/><circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="30" fill="#00E4FF"/>' +
        '<text x="' + xy[0] + '" y="' + (xy[1] + 8) + '" font-size="22" fill="#06161a" text-anchor="middle" font-weight="800">' + o.group.size + '</text>';
      if (!mini) h += '<text x="40" y="660" font-size="20" fill="#fff" font-weight="700">Planning ' + esc(o.group.id) + ' &#183; ' + o.group.size + ' people</text><text x="40" y="686" font-size="17" fill="#9fb9b7">' + (o.group.needs_step_free ? "needs step-free route" : "no step-free need") + ' &#183; at ' + esc(LOCS[o.group.node] || o.group.node) + '</text>';
    }
    return h + "</svg>";
  }
  // ------------------------------------------------------------ coordinator
  function renderCoord() {
    const el = $("#coord"); if (!el) return;
    const z = coordEngine(), now = S.now, g = draftGroup();
    const res = z.options(g, now);
    // follow the top-ranked station unless the coordinator picked one by hand (and it still fits)
    if (!S.coord.manual || !res.feasible.some((o) => o.station === S.coord.selected)) { S.coord.selected = res.feasible[0] ? res.feasible[0].station : null; S.coord.manual = false; }
    const sel = S.coord.selected;
    const selRoute = sel ? z.walkPath(g.node, z.st[sel].node, g.needs_step_free) : null;
    const reqs = Object.entries(S.eng.requests).filter(([rid, r]) => !S.dismissed[rid] && (["pending", "accepted"].includes(r.state) || now - (r.closed_at === undefined ? now : r.closed_at) <= 20)).reverse();

    let h = '<div class="sbar"><span>' + clock(now) + '</span><span class="island"></span><span>' + (S.offline ? '<b class="offl">OFFLINE</b>' : "LTE &#9679;&#9679;&#9679;") + '</span></div>';
    h += '<div class="appbar"><b class="brand-s">ZILL ' + AR + '</b><span class="tag">Coordinator</span></div>';
    h += '<div class="scr">';
    h += '<button class="emerg" data-act="emerg-info"><b>Suspected medical emergency?</b> Use the emergency procedure now &mdash; do not book a station.</button>';
    if (S.offline) h += '<div class="banner warn"><b>Offline.</b> Last synced ' + clock(S.offlineAt) + '. This list is <b>not live</b>: it is a reference only and will age out. Coordinate by radio.</div>';
    for (const [rid, r] of reqs) {
      let cls = "rq", body = "";
      if (r.state === "pending") { cls += " amber"; body = '<b>Waiting for ' + r.station + ' to confirm</b><span class="cdown">' + cd(r.sent + E.REQUEST_TIMEOUT_MIN - now) + '</span><div class="small">' + r.size + ' places held while staff decide. Lapses automatically if unanswered.</div>'; }
      else if (r.state === "accepted") { cls += " ok"; body = '<b>&#x2713; Confirmed by ' + r.station + ' staff</b><span class="cdown">ETA ' + clock(r.eta) + '</span><div class="small">Hold kept until ' + clock(r.eta + E.NO_SHOW_GRACE_MIN) + '. Not a guaranteed admission; never delay urgent help.</div>'; }
      else if (r.state === "arrived") { cls += " ok"; body = '<b>&#x2713; Arrived at ' + r.station + '</b>'; }
      else {
        cls += r.state === "station-closed" ? " bad" : " warn";
        const t = { declined: r.station + " declined. Choose another station below.", coordinate: r.station + " asks you to call them (radio).", lapsed: "No reply from " + r.station + " in 3 min. Request lapsed; re-plan below.", "station-closed": r.station + " closed. Your hold was cancelled; re-plan below.", "no-show": "Hold at " + r.station + " released (15 min after ETA)." }[r.state] || r.state;
        body = "<b>" + t + "</b>";
      }
      h += '<div class="' + cls + '"><div class="rq-h"><span class="gid">' + esc(r.group) + ' &middot; ' + r.size + ' people</span>' + (["pending", "accepted"].includes(r.state) ? "" : '<button class="x" data-act="c-dismiss" data-rid="' + rid + '" aria-label="Dismiss">&times;</button>') + '</div>' + body + '</div>';
    }
    h += '<div class="h">New group &middot; anonymous count only</div>';
    h += '<div class="card form"><div class="frow"><span class="lbl">Group</span><span class="gid big">' + esc(g.id) + '</span></div>';
    h += '<div class="frow"><span class="lbl">People</span><span class="stepper"><button data-act="c-size" data-d="-5" aria-label="minus 5">&minus;5</button><button data-act="c-size" data-d="-1" aria-label="minus 1">&minus;</button><b>' + S.coord.size + '</b><button data-act="c-size" data-d="1" aria-label="plus 1">+</button><button data-act="c-size" data-d="5" aria-label="plus 5">+5</button></span></div>';
    h += '<div class="frow"><span class="lbl">Where</span><span class="seg">' + Object.keys(LOCS).map((k) => '<button data-act="c-node" data-v="' + k + '" class="' + (S.coord.node === k ? "on" : "") + '">' + (k === "G" ? "Point G" : k === "B" ? "Junction B" : "Point E") + "</button>").join("") + '</span></div>';
    h += '<div class="chips"><span class="chip on lock">Cooling</span>' +
      [["rest", "Rest"], ["water", "Water"], ["wheel", "Wheelchair seats"]].map(([k, l]) => '<button class="chip ' + (S.coord[k] ? "on" : "") + '" data-act="c-need" data-k="' + k + '" aria-pressed="' + !!S.coord[k] + '">' + l + "</button>").join("") +
      '<button class="chip ' + (S.coord.stepFree ? "on" : "") + '" data-act="c-need" data-k="stepFree" aria-pressed="' + S.coord.stepFree + '">Step-free route</button></div></div>';
    h += '<div class="minimap">' + mapSVG({ z: z, now: now, mini: true, route: selRoute && selRoute.path, group: g, selected: sel }) + '</div>';
    if (res.manual) {
      h += '<div class="manual" role="status"><b>&#9888; Manual coordination needed</b><p>No station can confirm the whole group with live data right now. Contact the area supervisor by radio. Keep the group together; do not split it.</p></div>';
    } else {
      h += '<div class="h">Stations that can take the whole group</div>';
      res.feasible.forEach((o, i) => {
        const s = z.st[o.station], f = fresh(o.updated_min_ago);
        h += '<div class="opt ' + (o.station === sel ? "sel" : "") + '" data-act="c-sel" data-v="' + o.station + '" role="button" tabindex="0" aria-pressed="' + (o.station === sel) + '">' +
          '<div class="t"><span>' + (i === 0 ? '<i class="best">Nearest fit</i>' : "") + s.id + '</span><span>' + o.metres + ' m &middot; ~' + o.walk_min + ' min</span></div>' +
          '<div class="s">' + svcList(s) + '<br>' + o.free + ' places free &middot; approved' + (g.needs_step_free ? " step-free" : "") + ' route &middot; <span class="' + f.cls + '">' + f.tag + ', ' + f.txt + '</span></div>' +
          '<details class="why"><summary>Why this station?</summary><ul>' + z.explain(g, now, o.station).map((r) => '<li class="' + (r.ok ? "ok" : "no") + '">' + (r.ok ? "&#x2713;" : "&#x2717;") + " " + r.rule + ' <i>' + esc(r.note) + "</i></li>").join("") + '<li class="ok">&#x2713; Ranked by walking distance, then data freshness</li></ul></details></div>';
      });
    }
    if (res.excluded.length) h += '<div class="excl"><b>Not offered</b>' + res.excluded.map(([id, why]) => "<div><span>" + id + "</span> " + esc(why) + "</div>").join("") + "</div>";
    const canSend = sel && !S.offline && !res.manual;
    const o = res.feasible.find((x) => x.station === sel);
    h += '<button class="btn main" data-act="c-send" ' + (canSend ? "" : "disabled") + '>' + (S.offline ? "Offline &mdash; use radio" : canSend ? "Request arrival at " + sel + " &middot; ETA ~" + o.walk_min + " min" : "No station to request") + "</button>";
    h += '<p class="fine">Suggestions come from fixed rules only (no AI). A confirmed place is not a guaranteed admission.</p>';
    h += "</div>";
    h += '<div class="toasts">' + S.toasts.coord.map((t) => '<div class="toast ' + t.kind + (Date.now() - t.at < 300 ? ' new' : '') + '">' + t.html + "</div>").join("") + "</div>";
    h += '<div class="synth">Prototype &middot; synthetic data</div>';
    if (el._h === h) return;
    const sc = el.querySelector(".scr"), top = sc ? sc.scrollTop : 0;
    const open = $$("details.why[open]", el).map((d) => d.closest(".opt").dataset.v);
    el._h = h; el.innerHTML = h; phase(el);
    const sc2 = el.querySelector(".scr"); if (sc2) sc2.scrollTop = top;
    open.forEach((v) => { const d = el.querySelector('.opt[data-v="' + v + '"] details'); if (d) d.open = true; });
  }

  // ------------------------------------------------------------ station
  function renderStation() {
    const el = $("#station"); if (!el) return;
    const z = S.eng, now = S.now; z.expire(now);
    const s = z.st[S.stationId], f = fresh(s.age(now));
    const reqs = Object.entries(z.requests).filter(([, r]) => r.station === s.id);
    const pending = reqs.filter(([, r]) => r.state === "pending");
    const accepted = reqs.filter(([, r]) => r.state === "accepted");
    const recent = reqs.filter(([, r]) => ["arrived", "no-show", "lapsed", "declined", "coordinate", "station-closed"].includes(r.state) && now - (r.closed_at || 0) <= 30).reverse();
    const accN = accepted.reduce((a, [, r]) => a + r.size, 0), penN = pending.reduce((a, [, r]) => a + r.size, 0);
    const free = s.free(now), pct = (x) => Math.max(0, (100 * x) / s.capacity);
    let h = '<div class="tbar"><b>Station ' + s.id + ' &middot; ' + svcList(s) + '</b><span class="tsel">Demo: <select data-act="s-station" aria-label="Choose station">' + Object.keys(z.st).map((id) => '<option ' + (id === s.id ? "selected" : "") + ">" + id + "</option>").join("") + '</select></span><span class="tag">Station staff</span></div>';
    h += '<div class="tgrid"><div class="tcol">';
    h += '<div class="seg3" role="group" aria-label="Station status">' + ["open", "paused", "closed"].map((x) => '<button data-act="s-status" data-v="' + x + '" class="' + (s.status === x ? "on " + x : "") + '" aria-pressed="' + (s.status === x) + '">' + x[0].toUpperCase() + x.slice(1) + "</button>").join("") + "</div>";
    h += '<div class="card cap"><div class="h0">Can still accept</div><div class="bignum ' + (s.status !== "open" ? "dim" : "") + '">' + (s.status !== "open" ? "0" : Math.max(free, 0)) + '<span> places' + (s.status !== "open" ? " &middot; " + s.status : "") + '</span></div>' +
      '<div class="stack" aria-hidden="true"><i class="in" style="width:' + pct(s.occupancy) + '%"></i><i class="acc" style="width:' + pct(accN) + '%"></i><i class="pen" style="width:' + pct(penN) + '%"></i></div>' +
      '<div class="legend"><span><i class="in"></i>Inside ' + s.occupancy + '</span><span><i class="acc"></i>Accepted ' + accN + '</span><span><i class="pen"></i>Pending ' + penN + '</span><span>of ' + s.capacity + "</span></div>" +
      (f.cls === "stale" ? '<div class="stalebox"><b>&#9888; Not live: your count is ' + wm(s.age(now)) + ' min old.</b> Coordinators cannot be offered this station until you confirm.</div>' : '<div class="upd ' + f.cls + '">' + (f.cls === "fresh" ? "&#9679; " : "&#9888; ") + "You updated " + wm(s.age(now)) + " min ago" + (f.cls === "ageing" ? " &middot; please confirm" : "") + "</div>") +
      '<button class="btn alt sm" data-act="s-confirm">Count is correct &middot; confirm</button></div>';
    h += '<div class="tap"><button class="btn" data-act="s-occ" data-d="-1">&minus; Left</button><button class="btn" data-act="s-occ" data-d="1">+ Walk-in</button></div>';
    h += '<div class="tap sm"><button class="btn alt" data-act="s-occ" data-d="-5">&minus;5 left</button><button class="btn alt" data-act="s-occ" data-d="5">+5 walk-ins</button></div>';
    h += '</div><div class="tcol wide">';
    h += '<div class="h0">Arrival requests</div>';
    if (!pending.length) h += '<div class="empty">No requests waiting.</div>';
    for (const [rid, r] of pending) {
      const left = r.sent + E.REQUEST_TIMEOUT_MIN - now;
      h += '<div class="req"><div class="t"><span>' + esc(r.group) + ' &middot; ' + r.size + ' people</span><span class="pill warn">Answer in ' + cd(left) + '</span></div>' +
        '<div class="s">ETA ' + clock(r.eta) + ' &middot; ' + (r.step_free ? "<b>needs step-free access</b>" : "no step-free need") + ' &middot; from ' + (LOCS[r.node] || r.node) + ' &middot; needs ' + r.needs.join(", ") + '</div>' +
        '<div class="row3"><button class="btn" data-act="s-resp" data-rid="' + rid + '" data-v="accept">Accept</button><button class="btn alt" data-act="s-resp" data-rid="' + rid + '" data-v="declined">Decline</button><button class="btn alt" data-act="s-resp" data-rid="' + rid + '" data-v="coordinate">Call me</button></div></div>';
    }
    h += '<div class="h0">Incoming and recent</div><table class="tbl"><tr><th>Group</th><th>Size</th><th>ETA</th><th>Status</th><th></th></tr>';
    if (!accepted.length && !recent.length) h += '<tr><td colspan="5" class="empty">Nothing incoming.</td></tr>';
    for (const [rid, r] of accepted) {
      const late = now > r.eta;
      h += "<tr><td>" + esc(r.group) + "</td><td>" + r.size + "</td><td>" + (late ? '<span class="ageing">overdue ' + wm(now - r.eta) + " min</span>" : clock(r.eta)) + '</td><td><span class="pill ok">On the way</span></td><td><button class="btn xs" data-act="s-arrive" data-rid="' + rid + '">Arrived</button></td></tr>';
    }
    for (const [, r] of recent) {
      const cls = r.state === "arrived" ? "ok" : r.state === "no-show" || r.state === "station-closed" ? "bad" : "warn";
      h += "<tr><td>" + esc(r.group) + "</td><td>" + r.size + "</td><td>&mdash;</td><td><span class='pill " + cls + "'>" + STATE_TXT[r.state] + "</span></td><td></td></tr>";
    }
    h += "</table></div></div>";
    h += '<div class="toasts t2">' + S.toasts.station.map((t) => '<div class="toast ' + t.kind + (Date.now() - t.at < 300 ? ' new' : '') + '">' + t.html + "</div>").join("") + "</div>";
    h += '<div class="synth">Prototype &middot; synthetic data</div>';
    setHTML(el, h);
  }
  // ------------------------------------------------------------ supervisor
  function attention(z, now) {
    const a = [];
    for (const s of Object.values(z.st)) {
      const f = fresh(s.age(now));
      if (s.status === "closed") a.push(["bad", s.id + " is closed. Its holds were cancelled."]);
      else if (s.status === "paused") a.push(["warn", s.id + " is paused and not taking groups."]);
      else if (f.cls === "stale") a.push(["warn", s.id + " data is " + wm(s.age(now)) + " min old, so it is not offered. Call the station / confirm by radio."]);
      else if (f.cls === "ageing") a.push(["warn", s.id + " has not updated for " + wm(s.age(now)) + " min. It stops being offered after " + E.STALE_MIN + " min."]);
      else if (s.free(now) <= 5) a.push(["warn", s.id + " is near full (" + Math.max(0, s.free(now)) + " free)."]);
    }
    for (const rid in z.requests) {
      const r = z.requests[rid], ago = now - (r.closed_at === undefined ? now : r.closed_at);
      if (r.state === "pending" && now - r.sent >= 1) a.push(["warn", rid + " (" + r.group + " → " + r.station + ") unanswered for " + cd(now - r.sent) + "; lapses in " + cd(r.sent + E.REQUEST_TIMEOUT_MIN - now) + "."]);
      if (r.state === "accepted" && now > r.eta) a.push(["warn", r.group + " is overdue at " + r.station + "; hold released at " + clock(r.eta + E.NO_SHOW_GRACE_MIN) + "."]);
      if (ago > 30) continue;
      if (r.state === "no-show") a.push(["bad", r.group + " did not arrive at " + r.station + "; hold released."]);
      if (r.state === "lapsed") a.push(["warn", rid + " to " + r.station + " lapsed with no reply. Coordinator re-plans."]);
      if (r.state === "station-closed") a.push(["bad", r.group + "'s hold at " + r.station + " was cancelled (station closed). Coordinator re-plans."]);
      if (r.state === "coordinate") a.push(["warn", r.station + " asked " + r.group + "'s coordinator to call."]);
    }
    const g = draftGroup(); if (coordEngine().options(g, now).manual) a.push(["bad", "Coordinator: no station fits " + g.id + " (" + g.size + " people). Manual coordination needed."]);
    return a;
  }
  function renderSuper() {
    const el = $("#superLive"); if (!el) return;
    const z = S.eng, now = S.now; z.expire(now);
    const st = Object.values(z.st);
    const live = st.filter((s) => s.status === "open" && s.age(now) <= E.STALE_MIN);
    const reqs = Object.values(z.requests);
    const k = [
      ["Places free at live stations", live.reduce((a, s) => a + Math.max(0, s.free(now)), 0), ""],
      ["People on the way", reqs.filter((r) => r.state === "accepted").reduce((a, r) => a + r.size, 0), ""],
      ["Requests awaiting answer", reqs.filter((r) => r.state === "pending").length, reqs.some((r) => r.state === "pending") ? "warn" : ""],
      ["Stations not live / not open", st.filter((s) => s.age(now) > E.STALE_MIN || s.status !== "open").length, st.some((s) => s.age(now) > E.STALE_MIN || s.status !== "open") ? "warn" : ""],
      ["Overrides recorded", z.overrides.length, ""],
    ];
    let h = '<div class="kpis">' + k.map(([l, v, c]) => '<div class="kpi ' + c + '"><b>' + v + "</b><span>" + l + "</span></div>").join("") + "</div>";
    h += '<div class="tblwrap"><table class="tbl sup"><tr><th>Station</th><th>Status</th><th>Unallocated</th><th>Load</th><th>Incoming</th><th>Last update</th><th>Note</th></tr>';
    for (const s of st) {
      const f = fresh(s.age(now)), free = s.free(now);
      const inc = reqs.filter((r) => r.station === s.id && r.state === "accepted").reduce((a, r) => a + r.size, 0);
      const pen = reqs.filter((r) => r.station === s.id && r.state === "pending").reduce((a, r) => a + r.size, 0);
      let pill = '<span class="pill ok">Open</span>';
      if (s.status === "closed") pill = '<span class="pill bad">Closed</span>'; else if (s.status === "paused") pill = '<span class="pill warn">Paused</span>'; else if (f.cls === "stale") pill = '<span class="pill warn">Not live</span>';
      const notes = [];
      if (f.cls === "stale") notes.push("Not offered &middot; radio station");
      if (s.status === "open" && f.cls !== "stale" && free <= 5) notes.push("Near full");
      if (s.services.has("wheelchair-seating")) notes.push("Wheelchair seating");
      z.edges.filter((e) => e.status !== "approved" && (e.a === s.node || e.b === s.node)).forEach((e) => notes.push("Path " + e.a + "&ndash;" + e.b + " " + e.status));
      if (z.edges.some((e) => !e.step_free && (e.a === s.node || e.b === s.node))) notes.push("Stairs on last segment");
      const used = s.capacity - Math.max(free, 0);
      h += "<tr><td><b>" + s.id + "</b></td><td>" + pill + "</td><td>" + (f.cls === "stale" ? "&mdash;" : Math.max(free, 0) + " / " + s.capacity) + '</td><td><div class="mini-meter" title="' + used + ' of ' + s.capacity + ' used or held"><i style="width:' + Math.min(100, (100 * used) / s.capacity) + '%"></i></div></td><td>' + inc + (pen ? ' <span class="ageing">+' + pen + " pending</span>" : "") + '</td><td class="' + f.cls + '">' + wm(s.age(now)) + " min" + (f.cls === "stale" ? " &#9888; stale" : "") + "</td><td class='note'>" + notes.join(" &middot; ") + "</td></tr>";
    }
    h += "</table></div>";
    const att = attention(z, now);
    h += '<div class="sgrid"><div class="card"><div class="h0">Needs attention <span class="count">' + att.length + '</span></div><ul class="att">' + (att.length ? att.map(([c, t]) => '<li class="' + c + '"><b>' + (c === "bad" ? "Act" : "Check") + "</b> " + esc(t) + "</li>").join("") : '<li class="ok"><b>OK</b> Nothing needs attention.</li>') + "</ul></div>";
    h += '<div class="card"><div class="h0">Overrides today</div>' + (z.overrides.length ? '<ul class="ovl">' + z.overrides.slice().reverse().map((o) => "<li><b>" + clock(o.now) + "</b> " + esc(o.ref) + ": " + esc(o.action) + "<br><i>Reason recorded: " + esc(o.reason) + "</i></li>").join("") + "</ul>" : '<div class="empty">No overrides yet.</div>') + "</div></div>";
    h += '<div class="card log"><div class="h0">Decision log &middot; append-only <button class="btn xs alt" data-act="sv-export">Export CSV</button></div><ol>' + z.log.slice().reverse().slice(0, 60).map((l) => '<li class="' + (String(l[2]).indexOf("OVERRIDE") === 0 ? "ov" : "") + '"><b>' + clock(l[0]) + "</b><span>" + esc(l[1]) + "</span>" + esc(l[2]) + "</li>").join("") + (z.log.length ? "" : '<li class="empty">No decisions yet.</li>') + "</ol></div>";
    setHTML(el, h);
    refreshOverrideTargets(false);
  }
  // override form is static, so typing a reason is never interrupted by live re-renders
  function refreshOverrideTargets(force) {
    const act = $("#ovAction"), tgt = $("#ovTarget"); if (!act || !tgt) return;
    const z = S.eng, a = act.value; let opts = [];
    if (a === "radio") opts = Object.keys(z.st).map((id) => [id, id + " (" + fresh(z.st[id].age(S.now)).tag.toLowerCase() + ", " + wm(z.st[id].age(S.now)) + " min)"]);
    else if (a === "route-close") opts = z.edges.map((e, i) => [String(i), e]).filter((x) => x[1].status === "approved").map(([i, e]) => [i, e.a + "–" + e.b + " (" + e.metres + " m)"]);
    else if (a === "route-open") opts = z.edges.map((e, i) => [String(i), e]).filter((x) => x[1].status !== "approved").map(([i, e]) => [i, e.a + "–" + e.b + " (" + e.status + ")"]);
    else opts = Object.entries(z.requests).map(([rid, r]) => [rid, rid + " · " + r.group + " → " + r.station + " (" + r.state + ")"]).concat([["area", "Area-wide note"]]);
    const sig = a + "|" + opts.map((o) => o.join(":")).join(",");
    if (!force && tgt.dataset.sig === sig) return;
    const keep = tgt.value; tgt.dataset.sig = sig;
    tgt.innerHTML = opts.length ? opts.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + "</option>").join("") : "<option value=''>(none available)</option>";
    if (opts.some((o) => o[0] === keep)) tgt.value = keep;
    $("#ovNoteRow").style.display = a === "note" ? "" : "none";
    validateOverride();
  }
  function validateOverride() {
    const r = $("#ovReason"), b = $("#ovSubmit"), t = $("#ovTarget"); if (!r || !b) return;
    const ok = r.value.trim().length >= 3 && t.value !== "" && ($("#ovAction").value !== "note" || $("#ovNote").value.trim().length > 0);
    b.disabled = !ok; $("#ovHint").textContent = r.value.trim().length >= 3 ? "Will be added to the append-only log with your reason." : "A recorded reason is required before any override.";
  }
  function submitOverride() {
    const z = S.eng, a = $("#ovAction").value, t = $("#ovTarget").value, reason = $("#ovReason").value.trim();
    try {
      if (a === "radio") { z.override("supervisor", t, "confirmed station count by radio", reason, S.now); z.staff_update(t, S.now); }
      else if (a === "route-close") { const e = z.edges[+t]; z.override("supervisor", e.a + "-" + e.b, "closed route segment " + e.a + "–" + e.b, reason, S.now); e.status = "closed"; }
      else if (a === "route-open") { const e = z.edges[+t]; z.override("supervisor", e.a + "-" + e.b, "reopened route segment " + e.a + "–" + e.b, reason, S.now); e.status = "approved"; }
      else z.override("supervisor", t, $("#ovNote").value.trim(), reason, S.now);
      $("#ovReason").value = ""; $("#ovNote").value = "";
    } catch (err) { $("#ovHint").textContent = err.message; return; }
    refreshOverrideTargets(true); commit();
  }

  // ------------------------------------------------------------ area map card
  function renderMapCard() {
    const el = $("#mapLive"); if (!el) return;
    const g = draftGroup(), z = S.eng, sel = S.coord.selected;
    let route = null; if (sel && z.st[sel]) { const w = z.walkPath(g.node, z.st[sel].node, g.needs_step_free); route = w && w.path; }
    setHTML(el, mapSVG({ z: z, now: S.now, route: route, group: g, selected: sel, highlight: S.highlight }));
  }

  // ------------------------------------------------------------ scenario lab
  function labApply(i, k, jump) {
    const c = SC.run(i, k);
    S.lab.idx = i; S.lab.step = k; S.lab.ctx = c;
    if (jump) { S.toastOn = false; S.prev = {}; }
    S.eng = c.z; S.now = c.now;
    if (c.draft) S.coord = Object.assign({ selected: null }, c.draft);
    if (c.selected) S.coord.selected = c.selected;
    if (c.stationId) S.stationId = c.stationId;
    S.highlight = c.highlight; S.focus = SC.SCENARIOS[i].steps[k].focus;
    S.offline = false; S.offlineSnap = null; S.dismissed = {}; S.running = false;
    if (c.result) S.lab.results[i] = c.result; else delete S.lab.results[i];
    if (jump) { diffStates(); S.toasts = { coord: [], station: [] }; S.toastOn = true; }
    commit();
  }
  function labStart(i) { labStop(); labApply(i, 0, true); }
  function labNext() {
    const sc = SC.SCENARIOS[S.lab.idx];
    if (S.lab.step < sc.steps.length - 1) { labApply(S.lab.idx, S.lab.step + 1, false); return true; }
    if (S.lab.playAll && S.lab.idx < SC.SCENARIOS.length - 1) { labApply(S.lab.idx + 1, 0, true); return true; }
    return false;
  }
  function labPrev() { if (S.lab.step > 0) labApply(S.lab.idx, S.lab.step - 1, true); }
  function labPlay(all) {
    labStop(); S.lab.playing = true; S.lab.playAll = !!all;
    if (all) labApply(0, 0, true); else if (S.lab.step < 0 || S.lab.step >= SC.SCENARIOS[S.lab.idx].steps.length - 1) labApply(S.lab.idx, 0, true);
    S.lab.timer = setInterval(() => { if (!labNext()) labStop(); }, 5600);
    render();
  }
  function labStop() { if (S.lab.timer) clearInterval(S.lab.timer); S.lab.timer = null; S.lab.playing = false; S.lab.playAll = false; }
  function labRunAll() {
    const t0 = performance.now(); const r = SC.runAll(); const ms = performance.now() - t0;
    r.forEach((x, i) => { S.lab.results[i] = x; });
    S.lab.allRun = { at: new Date(), ms: ms, pass: r.filter((x) => x.pass).length, same: r.filter((x) => x.identical).length };
    render();
  }
  function renderLab() {
    const el = $("#lab"); if (!el) return;
    const L = S.lab, cur = SC.SCENARIOS[L.idx];
    let h = '<div class="lab-h"><div class="eyebrow">Scenario Lab</div><h2>The 7 scripted tests, replayed on the live screens</h2><p class="sub">Each step makes the same engine calls as <code>engine/run_scenarios.py</code>, at the same simulated minute. The replay is the test.</p></div>';
    h += '<div class="lab-ctl"><button class="btn" data-act="lab-playall">' + (L.playing && L.playAll ? "&#10074;&#10074; Stop" : "&#9654; Play all 7") + '</button><button class="btn alt" data-act="lab-runall">Run all 7 instantly</button></div>';
    if (L.allRun) h += '<div class="allrun ' + (L.allRun.pass === 7 && L.allRun.same === 7 ? "ok" : "bad") + '"><b>' + L.allRun.pass + '/7 pass</b> &middot; <b>' + L.allRun.same + '/7</b> identical, character for character, to the Python engine output<span>Ran in ' + L.allRun.ms.toFixed(1) + " ms at " + L.allRun.at.toLocaleTimeString() + "</span></div>";
    h += '<ol class="sclist">' + SC.SCENARIOS.map((sc, i) => {
      const r = L.results[i];
      return '<li class="' + (i === L.idx ? "cur" : "") + '"><button data-act="lab-sel" data-i="' + i + '"><span class="n">' + sc.n + '</span><span class="tt"><b>' + sc.title + "</b><i>" + sc.rule + "</i></span>" + (r ? '<span class="pill ' + (r.pass ? "ok" : "bad") + '">' + (r.pass ? "PASS" : "FAIL") + "</span>" : '<span class="pill mute">not run</span>') + "</button></li>";
    }).join("") + "</ol>";
    h += '<div class="scd"><div class="eyebrow">Scenario ' + cur.n + " &middot; " + cur.rule + "</div><h3>" + cur.title + "</h3><p>" + cur.summary + "</p>";
    h += '<div class="player"><button data-act="lab-restart" title="Restart" aria-label="Restart">&#8634;</button><button data-act="lab-prev" title="Previous step (left arrow)" aria-label="Previous step">&#9664;</button><button class="play" data-act="lab-play" title="Play / pause (space)" aria-label="Play or pause">' + (L.playing && !L.playAll ? "&#10074;&#10074;" : "&#9654;") + '</button><button data-act="lab-next" title="Next step (right arrow)" aria-label="Next step">&#9654;&#124;</button><span>' + (L.step < 0 ? "Not started" : "Step " + (L.step + 1) + " of " + cur.steps.length + " &middot; " + clock(S.now)) + "</span></div>";
    h += '<ol class="steps">' + cur.steps.map((st, k) => '<li class="' + (k === L.step ? "now" : k < L.step ? "done" : "") + '"><span class="fx">' + ({ coord: "Phone", station: "Tablet", super: "Desk", map: "Map" }[st.focus]) + "</span>" + st.say + "</li>").join("") + "</ol>";
    const r = L.results[L.idx];
    if (r && L.ctx && L.ctx.result) {
      h += '<div class="verdict ' + (r.pass ? "ok" : "bad") + '"><div class="vh"><b>' + (r.pass ? "&#x2713; PASS" : "&#x2717; FAIL") + '</b> Engine check (browser)</div><code>' + esc(r.detail) + "</code>" +
        '<div class="vh2 ' + (r.identical ? "ok" : "bad") + '">' + (r.identical ? "&#x2713; Identical to the Python reference output (run_scenarios.py: " + (r.refPass ? "PASS" : "FAIL") + ")" : "&#x2717; Differs from the Python reference") + "</div></div>";
    } else h += '<div class="verdict idle">The pass/fail check appears when the replay reaches the step where the Python test checks it.</div>';
    h += "</div>";
    setHTML(el, h);
    const cap = $("#caption");
    if (cap) {
      const st = L.step >= 0 ? cur.steps[L.step] : null;
      cap.innerHTML = st ? '<span class="cn">Scenario ' + cur.n + " &middot; step " + (L.step + 1) + "/" + cur.steps.length + "</span>" + st.say : "";
      cap.classList.toggle("on", !!st && S.mode === "lab");
    }
  }
  // ------------------------------------------------------------ guided tour (one screen at a time; drives the real engine)
  const TOUR = [
    { focus: "coord", top: true, t: "Meet the coordinator",
      say: "A field coordinator has 30 tired pilgrims at point G, two of them using wheelchairs. They enter only a head count, a location and access needs. No names. The emergency instruction always comes first." },
    { focus: "coord", options: true, t: "Five rules, no guesswork",
      say: "ZILL checks five fixed rules. S1 is closest but full, S2 has stairs, S4's data is 35 minutes old, so none of them is offered. S3 fits everyone on a step-free route. Every rule is shown, ticked." },
    { focus: "station", t: "The station is asked first",
      say: "The coordinator requests S3. Thirty places are held at once, and S3's staff see the request with a 3-minute countdown to accept, decline or ask for a call." },
    { focus: "coord", top: true, t: "Confirmed before anyone walks",
      say: "Staff tap Accept. The coordinator is told immediately, and the group now counts against S3's space, so nobody else can be promised the same places." },
    { focus: "map", t: "Only safe, approved routes",
      say: "The group walks the approved step-free route. The stairs to S2 and the closed path to S5 are never suggested." },
    { focus: "super", t: "One view for the supervisor",
      say: "The supervisor sees every station: free places, groups on the way, stale data. Any manual decision needs a recorded reason and goes into an append-only log." },
    { focus: "end", t: "Tested, not just designed",
      say: "Seven scripted scenarios pass, and the browser engine matches the original Python engine character for character. All data here is synthetic; nothing is connected to a real system." },
  ];
  function tourApply(k) {
    k = Math.max(0, Math.min(TOUR.length - 1, k));
    S.tour.step = k;
    const a = E.demo_area(); const z = new E.Zill(a[0], a[1]);
    const g = new E.Group("G-30", 30, "G", true, ["cooling", "rest"]);
    S.now = 5; S.stationId = "S3"; S.offline = false; S.offlineSnap = null; S.running = false; S.dismissed = {}; S.highlight = null;
    S.coord = { size: 30, node: "G", stepFree: true, rest: true, water: false, wheel: false, selected: "S3", manual: false, id: "G-30" };
    if (k >= 2) z.request(g, "S3", 5, 14);
    if (k >= 3) { S.now = 6; z.respond("R1", "accept", 6); }
    if (k >= 4) S.now = 11;
    S.toastOn = false; S.eng = z; S.prev = {}; diffStates(); S.toasts = { coord: [], station: [] }; S.toastOn = true;
    commit();
    window.scrollTo(0, 0);
    setTimeout(() => {
      const sc = $("#coord .scr"); if (!sc) return;
      if (TOUR[k].options) {
        const d = $("#coord .opt details"); if (d) d.open = true;
        const h = $$("#coord .h").find((x) => /whole group/.test(x.textContent));
        sc.scrollTop = h ? Math.max(0, h.offsetTop - sc.offsetTop - 8) : 0;
      } else sc.scrollTop = 0;
    }, 80);
  }
  function tourStop() { if (S.tour.timer) clearInterval(S.tour.timer); S.tour.timer = null; }
  function tourPlay() {
    if (S.tour.timer) { tourStop(); render(); return; }
    if (S.tour.step >= TOUR.length - 1) tourApply(0);
    S.tour.timer = setInterval(() => { if (S.tour.step >= TOUR.length - 1) { tourStop(); render(); } else tourApply(S.tour.step + 1); }, 7500);
    render();
  }
  function renderTour() {
    const el = $("#tourCard"); if (!el) return;
    const k = S.tour.step, st = TOUR[k], last = k === TOUR.length - 1;
    let h = '<div class="tk">Guided tour &middot; step ' + (k + 1) + " of " + TOUR.length + '<span>Synthetic data &middot; prototype</span></div><h2>' + st.t + "</h2><p>" + st.say + "</p>";
    h += '<div class="tctl"><button class="btn alt" data-act="tour-prev"' + (k === 0 ? " disabled" : "") + '>&larr; Back</button>' +
      '<button class="btn mid" data-act="tour-play">' + (S.tour.timer ? "&#10074;&#10074; Pause" : "&#9654; Play") + "</button>" +
      '<button class="btn go" data-act="tour-next">' + (last ? "Explore the full demo &rarr;" : "Next &rarr;") + "</button></div>";
    h += '<div class="tdots">' + TOUR.map((_, i) => '<button data-act="tour-go" data-i="' + i + '" aria-label="Step ' + (i + 1) + '" class="' + (i === k ? "on" : i < k ? "done" : "") + '"></button>').join("") + "</div>";
    setHTML(el, h);
    const end = $("#tourEnd");
    if (end && st.focus === "end" && !end.dataset.done) {
      const r = SC.runAll(), pass = r.filter((x) => x.pass).length, same = r.filter((x) => x.identical).length;
      end.innerHTML = '<div class="tebig"><b>' + pass + "/7</b> scenarios pass<span>&middot;</span><b>" + same + "/7</b> identical to the Python engine</div>" +
        '<ol class="telist">' + SC.SCENARIOS.map((s, i) => "<li><span>" + s.n + "</span><b>" + s.title + "</b><i>" + s.rule + '</i><em class="' + (r[i].pass ? "ok" : "bad") + '">' + (r[i].pass ? "PASS" : "FAIL") + "</em></li>").join("") + "</ol>" +
        '<div class="tecta"><button class="btn" data-act="tour-explore">Explore the full live demo</button><button class="btn alt" data-act="mode" data-v="lab">Replay the 7 scenarios</button><button class="btn alt" data-act="mode" data-v="evidence">What is tested, what is not</button></div>';
      end.dataset.done = 1;
    }
  }

  // ------------------------------------------------------------ evidence
  // engine/simulation_results.json (illustrative, synthetic demand, 300 runs)
  const SIM = [
    ["A · Nearest station, no capacity info", { t: 136.8, w: 218.1, u: 0.0 }, ""],
    ["B · Capacity report every 15 min", { t: 101.2, w: 330.6, u: 0.0 }, ""],
    ["ZILL rules · live updates + confirmed holds", { t: 0.0, w: 223.8, u: 13.8 }, "z"],
    ["ZILL · 30% walk-ins logged 10 min late", { t: 59.6, w: 249.1, u: 6.7 }, "s"],
    ["ZILL · 60% walk-ins logged 10 min late", { t: 112.4, w: 255.0, u: 1.5 }, "s"],
  ];
  function bars(m, unit, max) {
    return '<div class="bars">' + SIM.map(([k, v, c]) => '<div class="bar ' + c + '"><span class="bl">' + k + '</span><span class="bt"><i style="width:' + Math.max(0.8, (100 * v[m]) / max) + '%"></i></span><b>' + v[m].toFixed(1) + unit + "</b></div>").join("") + "</div>";
  }
  function renderEvidence() {
    const el = $("#simCharts"); if (!el || el.dataset.done) return; el.dataset.done = 1;
    el.innerHTML = '<div class="chart"><h4>Groups that walked to a station and found it full, per 100 groups <em>lower is better</em></h4>' + bars("t", "", 140) + "</div>" +
      '<div class="chart"><h4>Groups shown the manual-coordination prompt, per 100 <em>the trade-off: ZILL says so up front instead of sending a group to a full station</em></h4>' + bars("u", "", 140) + "</div>" +
      '<div class="chart"><h4>Mean extra walking compared with the nearest station <em>metres</em></h4>' + bars("w", " m", 340) + "</div>";
  }

  // ------------------------------------------------------------ shell
  function renderTop() {
    $("#clock").textContent = clock(S.now);
    $("#clockBtn").innerHTML = S.running ? "&#10074;&#10074;" : "&#9654;";
    $("#clockBtn").setAttribute("aria-label", S.running ? "Pause simulated clock" : "Run simulated clock");
    $("#offBtn").classList.toggle("on", S.offline);
    $("#offBtn").setAttribute("aria-pressed", S.offline);
    $$(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.mode));
    $$(".lay button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.layout));
    document.body.dataset.mode = S.mode; document.body.dataset.layout = S.layout;
    if (KIOSK) document.body.dataset.kiosk = KIOSK;
    $$(".dev").forEach((d) => { d.classList.toggle("focus", S.mode === "lab" && d.dataset.role === S.focus); d.classList.toggle("tourfocus", S.mode === "tour" && d.dataset.role === TOUR[S.tour.step].focus); });
    if (S.mode === "tour" && TOUR[S.tour.step].focus === "end") document.body.dataset.tourEnd = "1"; else delete document.body.dataset.tourEnd;
  }
  function render() {
    if (!S.eng) return;
    diffStates();
    renderTop();
    if (S.mode === "ops" || S.mode === "lab" || S.mode === "tour") { renderCoord(); renderStation(); renderSuper(); renderMapCard(); }
    if (S.mode === "tour") renderTour();
    if (S.mode === "lab") renderLab(); else { const cap = $("#caption"); if (cap) cap.classList.remove("on"); }
    if (S.mode === "evidence") renderEvidence();
  }

  function modal(title, body, okLabel, onOk) {
    const m = $("#modal");
    m.innerHTML = '<div class="mbox" role="dialog" aria-modal="true" aria-labelledby="mt"><h3 id="mt">' + title + "</h3><p>" + body + '</p><div class="mrow">' + (onOk ? '<button class="btn alt" data-m="0">Cancel</button>' : "") + '<button class="btn" data-m="1">' + okLabel + "</button></div></div>";
    m.classList.add("on");
    m.onclick = (ev) => { const b = ev.target.closest("[data-m]"); if (!b && ev.target !== m) return; m.classList.remove("on"); if (b && b.dataset.m === "1" && onOk) onOk(); };
    const ok = m.querySelector('[data-m="1"]'); if (ok) ok.focus();
  }

  function setMode(v) {
    if (S.mode === "lab" && v !== "lab") labStop();
    if (S.mode === "tour" && v !== "tour") { tourStop(); if (v === "ops") resetLive(); }
    if (v === "tour") { labStop(); S.mode = "tour"; tourApply(0); return; }
    if (v === "lab" && S.lab.step < 0) { S.mode = "lab"; window.scrollTo(0, 0); labApply(S.lab.idx, 0, true); return; }
    S.mode = v; window.scrollTo(0, 0); render();
  }

  // ------------------------------------------------------------ events
  let lastT = performance.now();
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    if (b.tagName === "SELECT") return;
    const a = b.dataset.act, z = S.eng, now = S.now;
    switch (a) {
      case "mode": { const pm = $("#presenter"); if (pm) pm.open = false; setMode(b.dataset.v); break; }
      case "tour-next": if (S.tour.step >= TOUR.length - 1) { tourStop(); setMode("ops"); } else { tourStop(); tourApply(S.tour.step + 1); } break;
      case "tour-prev": tourStop(); tourApply(S.tour.step - 1); break;
      case "tour-go": tourStop(); tourApply(+b.dataset.i); break;
      case "tour-play": tourPlay(); break;
      case "tour-explore": tourStop(); setMode("ops"); break;
      case "layout": S.layout = b.dataset.v; if (S.mode !== "ops") S.mode = "ops"; render(); break;
      case "clock": S.running = !S.running; lastT = performance.now(); if (S.mode === "lab") { labStop(); } render(); break;
      case "step": S.now += +b.dataset.d; commit(); break;
      case "reset": labStop(); resetLive(); S.lab.step = -1; S.lab.results = {}; S.lab.allRun = null; if (S.mode === "lab") S.mode = "ops"; commit(); break;
      case "offline":
        S.offline = !S.offline;
        if (S.offline) { S.offlineSnap = S.eng.toJSON(); S.offlineAt = S.now; } else S.offlineSnap = null;
        commit(); break;
      case "open": {
        const v = b.dataset.v, W = { coord: 440, station: 1000, super: 1300, map: 1120 }, H = { coord: 880, station: 700, super: 920, map: 780 };
        window.open(location.pathname + "?device=" + v + (v === "station" ? "&station=" + S.stationId : ""), "zill_" + v + (v === "station" ? S.stationId : ""), "width=" + W[v] + ",height=" + H[v]);
        setTimeout(() => broadcast(true), 600); break;
      }
      case "c-size": S.coord.size = Math.max(1, Math.min(200, S.coord.size + +b.dataset.d)); S.coord.id = null; S.coord.manual = false; commit(); break;
      case "c-node": S.coord.node = b.dataset.v; S.coord.manual = false; commit(); break;
      case "c-need": S.coord[b.dataset.k] = !S.coord[b.dataset.k]; S.coord.manual = false; commit(); break;
      case "c-sel": if (ev.target.closest("details")) return; S.coord.selected = b.dataset.v; S.coord.manual = true; commit(); break;
      case "c-dismiss": S.dismissed[b.dataset.rid] = 1; commit(); break;
      case "c-send": {
        const g = draftGroup(); const res = z.options(g, now); const o = res.feasible.find((x) => x.station === S.coord.selected);
        if (!o) break;
        const rid = z.request(g, o.station, now, o.walk_min);
        if (!rid) toast("coord", "Request refused: " + o.station + " no longer has space for the whole group.", "bad");
        S.coord.id = null; S.coord.manual = false; commit(); break;
      }
      case "s-status": {
        const s = z.st[S.stationId], v = b.dataset.v; if (s.status === v) break;
        const affected = Object.keys(s.holds).length;
        const go = () => { z.staff_update(S.stationId, S.now, null, v); commit(); };
        if (v !== "open" && affected) modal((v === "closed" ? "Close " : "Pause ") + s.id + "?", "This cancels " + affected + " hold(s) for groups coming here. Their coordinators are told at once and re-plan.", v === "closed" ? "Close station" : "Pause station", go);
        else go();
        break;
      }
      case "s-occ": { const s = z.st[S.stationId]; z.staff_update(S.stationId, now, Math.max(0, Math.min(s.capacity, s.occupancy + +b.dataset.d))); commit(); break; }
      case "s-confirm": z.staff_update(S.stationId, now); commit(); break;
      case "s-resp": z.respond(b.dataset.rid, b.dataset.v, now); commit(); break;
      case "s-arrive": z.arrive(b.dataset.rid, now); commit(); break;
      case "sv-export": {
        const rows = [["sim_time", "ref", "event"]].concat(z.log.map((l) => [clock(l[0]), l[1], l[2]]));
        const csv = "# ZILL prototype decision log. SYNTHETIC DATA ONLY.\n" + rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\n");
        const url = URL.createObjectURL(new Blob([String.fromCharCode(0xFEFF) + csv], { type: "text/csv" }));
        const aEl = document.createElement("a"); aEl.href = url; aEl.download = "zill_decision_log_SYNTHETIC.csv"; document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); break;
      }
      case "ov-submit": submitOverride(); break;
      case "lab-sel": labStart(+b.dataset.i); break;
      case "lab-play": if (S.lab.playing && !S.lab.playAll) { labStop(); render(); } else labPlay(false); break;
      case "lab-playall": if (S.lab.playing && S.lab.playAll) { labStop(); render(); } else labPlay(true); break;
      case "lab-next": labStop(); labNext(); render(); break;
      case "lab-prev": labStop(); labPrev(); render(); break;
      case "lab-restart": labStart(S.lab.idx); break;
      case "lab-runall": labRunAll(); break;
      case "emerg-info": modal("Use the emergency procedure", "Follow your team's emergency procedure now. ZILL is not a triage or diagnosis tool, and booking a station must never delay urgent help.<br><br><small>Prototype placeholder: no real procedure, number or service is linked.</small>", "Understood", null); break;
    }
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.act === "s-station") { S.stationId = t.value; commit(); }
    if (t.id === "speed") S.speed = +t.value;
    if (t.id === "ovAction") refreshOverrideTargets(true);
    if (t.id === "ovTarget") validateOverride();
  });
  document.addEventListener("input", (ev) => { if (ev.target.id === "ovReason" || ev.target.id === "ovNote") validateOverride(); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $("#modal").classList.remove("on");
    if (ev.target.closest("input,textarea,select")) return;
    if (ev.key === "Enter" && ev.target.matches(".opt")) { ev.target.click(); return; }
    if (S.mode === "tour") {
      if (ev.key === "ArrowRight") { tourStop(); if (S.tour.step < TOUR.length - 1) tourApply(S.tour.step + 1); ev.preventDefault(); }
      if (ev.key === "ArrowLeft") { tourStop(); tourApply(S.tour.step - 1); ev.preventDefault(); }
    }
    if (S.mode === "lab") {
      if (ev.key === "ArrowRight") { labStop(); labNext(); render(); ev.preventDefault(); }
      if (ev.key === "ArrowLeft") { labStop(); labPrev(); render(); ev.preventDefault(); }
      if (ev.key === " " && !ev.target.closest("button")) { if (S.lab.playing) { labStop(); render(); } else labPlay(false); ev.preventDefault(); }
    }
  });

  // simulated clock
  setInterval(() => {
    const t = performance.now(), dt = (t - lastT) / 1000; lastT = t;
    if (S.running && !KIOSK) { S.now += (dt * S.speed) / 60; broadcast(false); }
    if (S.mode !== "intro" && S.mode !== "evidence") render();
  }, 250);

  // boot
  if (KIOSK && chan) chan.postMessage({ from: TAB, hello: true });
  // deep links for demos and screenshots: ?mode=ops|lab|evidence &layout= &preset=flow|radio &scenario=N&step=K &shot=1
  function applyPreset(name) {
    const z = S.eng;
    if (name === "story") { S.now = 5; S.coord = { size: 30, node: "G", stepFree: true, rest: true, water: false, wheel: false, selected: null, id: "G-30" }; return; }
    const g1 = new E.Group("G-25", 25, "G");
    const o1 = z.options(g1, 5).feasible[0];
    const r1 = z.request(g1, o1.station, 5, o1.walk_min); z.respond(r1, "accept", 6);
    z.staff_update("S1", 7); z.staff_update("S3", 8); z.staff_update("S5", 8);
    z.request(new E.Group("G-14", 14, "G"), "S2", 9.4, 12);
    if (name === "radio") { z.override("supervisor", "S4", "confirmed station count by radio", "called S4 staff; count read back (synthetic example)", 9.5); z.staff_update("S4", 9.5); }
    S.now = 10; S.coord = { size: 30, node: "G", stepFree: true, rest: true, water: false, wheel: true, selected: null, id: "G-30" };
  }
  if (params.get("preset")) applyPreset(params.get("preset"));
  if (params.get("scenario")) { S.mode = "lab"; labApply(+params.get("scenario") - 1, Math.max(0, (+params.get("step") || 1) - 1), true); }
  else if (params.get("mode") === "tour") { S.mode = "tour"; tourApply(+(params.get("step") || 1) - 1); }
  else if (params.get("mode")) S.mode = params.get("mode");
  if (params.get("runall")) labRunAll();
  if (params.get("layout")) S.layout = params.get("layout");
  if (params.get("station")) S.stationId = params.get("station");
  if (params.get("shot")) document.body.dataset.shot = "1";
  if (params.get("why") || params.get("scroll")) setTimeout(() => { const d = document.querySelector("#coord .opt details"); if (d && params.get("why")) d.open = true; const sc = document.querySelector("#coord .scr"); if (sc) sc.scrollTop = +(params.get("scroll") || 0); }, 400);
  // phones (e.g. judges scanning the QR code) land straight in the guided tour
  if (!KIOSK && !location.search && window.matchMedia && window.matchMedia("(max-width: 760px)").matches) { S.mode = "tour"; tourApply(0); }
  window.ZILL = { state: S, render: render, runAll: () => SC.runAll() };
  render();
})();
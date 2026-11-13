/*
 * The 7 scripted scenarios from engine/run_scenarios.py, replayed step by step.
 * Each step performs exactly the engine calls the Python test makes, at the same
 * simulated minute, so the replay IS the test. The final detail string is built
 * the way Python prints it and compared, character for character, with the
 * reference output saved by the Python run (engine/scenario_results.json).
 * Synthetic data only.
 */
(function (global) {
  "use strict";
  const E = global.ZillEngine;
  const q = (s) => "'" + s + "'";
  const pyList = (a) => "[" + a.map(q).join(", ") + "]";
  const pyPairs = (a) => "[" + a.map((p) => "(" + q(p[0]) + ", " + q(p[1]) + ")").join(", ") + "]";
  const pyB = (b) => (b ? "True" : "False");
  const ids = (o) => o.map((x) => x.station);
  const fresh = () => { const a = E.demo_area(); return new E.Zill(a[0], a[1]); };

  // Output of `python run_scenarios.py` (engine/scenario_results.json), verbatim.
  const PY_REFERENCE = [
    { scenario: "1 Ordinary request", pass: true, detail: "options=['S2', 'S3', 'S5'], top=S2, excluded=[('S1', 'space 2 < group 25 (not split)'), ('S4', 'info 35 min old — confirm by radio')]" },
    { scenario: "2 Nearest station full", pass: true, detail: "S1 excluded: [('S1', 'space 2 < group 25 (not split)')]" },
    { scenario: "3 Two groups, same space", pass: true, detail: "first=R1, second=None; second group now offered ['S5']" },
    { scenario: "4 Accessible route", pass: true, detail: "options=['S3', 'S5'], S2 reason=['no approved step-free route']" },
    { scenario: "5 Station closes", pass: true, detail: "request state=station-closed, new options=['S3', 'S5']" },
    { scenario: "6 Stale info -> manual", pass: true, detail: "manual=True, reasons=[('S1', 'info 30 min old — confirm by radio'), ('S2', 'info 30 min old — confirm by radio'), ('S3', 'info 30 min old — confirm by radio'), ('S4', 'info 35 min old — confirm by radio'), ('S5', 'info 30 min old — confirm by radio')]" },
    { scenario: "Extra: expiry, no-show, override reason", pass: true, detail: "lapsed=True, no-show released=True, override needs reason=True" },
  ];

  const SCENARIOS = [
    {
      n: 1, title: "Ordinary request", rule: "Rules 1–5 · rank + confirm",
      summary: "A group of 25 at assembly point G, no special needs. ZILL offers the nearest station that fits the whole group and the station confirms.",
      steps: [
        { focus: "map", say: "Synthetic demo area loads at 14:05 (simulated). Five stations, one closed path, one stairway.",
          do(c) { c.z = fresh(); c.now = 5; c.coord({ id: "G-25", size: 25, node: "G" }); c.station("S2"); } },
        { focus: "coord", say: "The coordinator enters group G-25: 25 people at G, cooling, no step-free need. S2 ranks first at 500 m. S1 is closer but has only 2 places.",
          do(c) { c.v.g = new E.Group("G-25", 25, "G"); const r = c.z.options(c.v.g, 5); c.v.opts = r.feasible; c.v.exc = r.excluded; c.v.top = r.feasible[0] ? r.feasible[0].station : null; c.select(c.v.top); } },
        { focus: "station", say: "Request sent to S2. 25 places are held provisionally; S2 staff have 3 minutes to answer.",
          do(c) { c.v.rid = c.z.request(c.v.g, c.v.top, 5, 8); } },
        { focus: "coord", say: "At 14:06 S2 staff tap Accept. The coordinator sees the confirmation at once; the supervisor sees 25 people incoming.",
          do(c) { c.now = 6; c.z.respond(c.v.rid, "accept", 6); } },
      ],
      check(c) { const v = c.v; return { pass: v.top === "S2" && c.z.requests[v.rid].state === "accepted", detail: "options=" + pyList(ids(v.opts)) + ", top=" + v.top + ", excluded=" + pyPairs(v.exc) }; },
    },
    {
      n: 2, title: "Nearest station full", rule: "Rule 4 · never split",
      summary: "S1 is only 150 m away but has 2 free places. A group of 25 is never split, so S1 is not offered and the reason is shown.",
      steps: [
        { focus: "map", say: "Same synthetic area. S1 is the closest station: 150 m from assembly point G.",
          do(c) { c.z = fresh(); c.now = 5; c.coord({ id: "G-25", size: 25, node: "G" }); c.station("S1"); c.hl("S1"); } },
        { focus: "coord", say: "S1 has 2 free places for 25 people. The group is never split, so S1 is not offered and the phone says why: 'space 2 < group 25 (not split)'.",
          do(c) { const r = c.z.options(new E.Group("G-25", 25, "G"), 5); c.v.opts = r.feasible; c.v.exc = r.excluded; c.select(r.feasible[0] && r.feasible[0].station); } },
      ],
      check(c) { const v = c.v; return { pass: !ids(v.opts).includes("S1") && v.exc.some((e) => e[0] === "S1" && e[1].includes("space")), detail: "S1 excluded: " + pyPairs(v.exc.filter((e) => e[0] === "S1")) }; },
    },
    {
      n: 3, title: "Two groups, same space", rule: "Edge case · first hold wins",
      summary: "Two groups of 20 ask for the last 30 places at S3 at the same minute. The first places a hold; the second only sees what is left, so S3 is never over-booked.",
      steps: [
        { focus: "station", say: "To push both groups toward S3, S2's staff pause their station. S3 has 30 free places.",
          do(c) { c.z = fresh(); c.now = 5; c.z.st.S2.status = "paused"; c.z.st.S2.updated_at = 0; c.station("S3"); c.coord({ id: "G-A", size: 20, node: "G" }); } },
        { focus: "station", say: "Group G-A (20) requests S3. A hold of 20 is placed at once, leaving 10.",
          do(c) { c.v.ga = new E.Group("G-A", 20, "G"); c.v.ra = c.z.request(c.v.ga, "S3", 5, 10); c.select("S3"); } },
        { focus: "super", say: "Group G-B (20) requests S3 in the same minute. Requests are handled one at a time: only 10 places remain, so it is refused and S3 is not over-booked.",
          do(c) { c.v.gb = new E.Group("G-B", 20, "G"); c.v.rb = c.z.request(c.v.gb, "S3", 5, 10); c.coord({ id: "G-B", size: 20, node: "G" }); } },
        { focus: "coord", say: "G-B's coordinator re-plans: S3 is no longer offered, S5 is.",
          do(c) { const r = c.z.options(c.v.gb, 5); c.v.optsb = r.feasible; c.select(r.feasible[0] && r.feasible[0].station); } },
      ],
      check(c) { const v = c.v; return { pass: !!v.ra && v.rb === null && !ids(v.optsb).includes("S3"), detail: "first=" + v.ra + ", second=" + (v.rb === null ? "None" : v.rb) + "; second group now offered " + pyList(ids(v.optsb)) }; },
    },
    {
      n: 4, title: "Accessible route", rule: "Rule 1 · step-free routes only",
      summary: "A group of 12 includes wheelchair users. S2's last segment is stairs, so only stations with an approved step-free route are offered.",
      steps: [
        { focus: "map", say: "Group G-W: 12 people, including wheelchair users. The B–S2 segment is stairs.",
          do(c) { c.z = fresh(); c.now = 5; c.coord({ id: "G-W", size: 12, node: "G", stepFree: true }); c.station("S3"); c.hl("S2"); } },
        { focus: "coord", say: "There is no approved step-free route to S2, so it is not offered. S3 is first: 700 m, step-free, with wheelchair seating.",
          do(c) { const g = new E.Group("G-W", 12, "G", true); const r = c.z.options(g, 5); c.v.optw = r.feasible; c.v.excw = r.excluded; c.select(r.feasible[0] && r.feasible[0].station); } },
      ],
      check(c) { const v = c.v; return { pass: v.optw.length > 0 && v.optw[0].station === "S3" && v.excw.some((e) => e[0] === "S2" && e[1].includes("route")), detail: "options=" + pyList(ids(v.optw)) + ", S2 reason=" + pyList(v.excw.filter((e) => e[0] === "S2").map((e) => e[1])) }; },
    },
    {
      n: 5, title: "Station closes", rule: "Edge case · closing cancels holds",
      summary: "S2 accepts a group of 30, then has to close. The hold is cancelled, the coordinator is told, and the re-plan never includes S2.",
      steps: [
        { focus: "coord", say: "Group G-30 (30 people) requests S2 at 14:05.",
          do(c) { c.z = fresh(); c.now = 5; c.coord({ id: "G-30", size: 30, node: "G" }); c.station("S2"); c.v.g = new E.Group("G-30", 30, "G"); c.v.rid = c.z.request(c.v.g, "S2", 5, 8); c.select("S2"); } },
        { focus: "station", say: "At 14:06 S2 staff accept. 30 places are held until ETA + 15 min.",
          do(c) { c.now = 6; c.z.respond(c.v.rid, "accept", 6); } },
        { focus: "station", say: "At 14:07 S2 has to close. Closing cancels its holds; the coordinator's phone shows 'S2 closed — re-plan'.",
          do(c) { c.now = 7; c.z.staff_update("S2", 7, null, "closed"); } },
        { focus: "coord", say: "The re-plan offers S3 and S5. S2 cannot be chosen while it is closed.",
          do(c) { const r = c.z.options(c.v.g, 7); c.v.opts5 = r.feasible; c.select(r.feasible[0] && r.feasible[0].station); } },
      ],
      check(c) { const v = c.v, st = c.z.requests[v.rid].state; return { pass: st === "station-closed" && !ids(v.opts5).includes("S2") && v.opts5.length > 0, detail: "request state=" + st + ", new options=" + pyList(ids(v.opts5)) }; },
    },
    {
      n: 6, title: "Stale info → manual", rule: "Rule 2 · never show stale as live",
      summary: "No station has updated for 30 minutes. ZILL offers nothing rather than guessing, and shows the manual-coordination prompt.",
      steps: [
        { focus: "super", say: "No station has sent an update for 30 minutes. The supervisor sees every station flagged 'Not live'.",
          do(c) { c.z = fresh(); c.now = 5; ["S1", "S2", "S3", "S5"].forEach((s) => { c.z.st[s].updated_at = -25; }); c.coord({ id: "G-40", size: 40, node: "G" }); c.station("S2"); } },
        { focus: "coord", say: "Group G-40 asks for a station. Nothing is offered as live; the phone shows the manual-coordination prompt: coordinate by radio and keep the group together.",
          do(c) { const r = c.z.options(new E.Group("G-40", 40, "G"), 5); c.v.opts6 = r.feasible; c.v.exc6 = r.excluded; c.v.manual6 = r.manual; } },
      ],
      check(c) { const v = c.v; return { pass: v.manual6 && v.opts6.length === 0 && v.exc6.every((e) => e[1].includes("radio") || e[1].includes("closed")), detail: "manual=" + pyB(v.manual6) + ", reasons=" + pyPairs(v.exc6) }; },
    },
    {
      n: 7, title: "Expiry, no-show, override", rule: "Timers + accountability",
      summary: "An unanswered request lapses after 3 min, an accepted hold is released 15 min after the ETA (no-show), and an override without a reason is refused.",
      checkAt: 4,
      steps: [
        { focus: "station", say: "14:00. Group G-15 requests S5. 15 places are held while S5 decides.",
          do(c) { c.z = fresh(); c.now = 0; c.station("S5"); c.coord({ id: "G-15", size: 15, node: "G" }); c.v.r = c.z.request(new E.Group("G-15", 15, "G"), "S5", 0, 10); c.v.free_before = c.z.st.S5.free(1); c.select("S5"); } },
        { focus: "coord", say: "14:04. No reply within 3 minutes, so the request lapses: the 15 places are released and the coordinator is told to re-plan.",
          do(c) { c.now = 4; c.z.expire(4); c.v.lapsed = c.z.requests[c.v.r].state === "lapsed" && c.z.st.S5.free(4) === c.v.free_before + 15; } },
        { focus: "station", say: "Group G-16 requests S5 and staff accept at 14:05. ETA 14:09; the hold lasts until 14:24.",
          do(c) { c.coord({ id: "G-16", size: 16, node: "G" }); c.v.r2 = c.z.request(new E.Group("G-16", 16, "G"), "S5", 4, 5); c.now = 5; c.z.respond(c.v.r2, "accept", 5); } },
        { focus: "super", say: "14:25. G-16 never arrived. 15 minutes after the ETA the hold is released as a no-show and the places become available again.",
          do(c) { c.now = 25; c.z.expire(4 + 5 + 15 + 1); c.v.noshow = c.z.requests[c.v.r2].state === "no-show"; } },
        { focus: "super", say: "14:30. A supervisor tries to override with no reason. The engine refuses: every override needs a recorded reason.",
          do(c) { c.now = 30; try { c.z.override("supervisor", "G-16", "send to S4", "", 30); c.v.ov = false; } catch (e) { c.v.ov = true; } } },
        { focus: "super", say: "With a reason recorded, the override is accepted and added to the append-only decision log.",
          do(c) { c.z.override("supervisor", "G-16", "send to S3 instead", "elderly member, stay near exit (synthetic example)", 30); } },
      ],
      check(c) { const v = c.v; return { pass: v.lapsed && v.noshow && v.ov, detail: "lapsed=" + pyB(v.lapsed) + ", no-show released=" + pyB(v.noshow) + ", override needs reason=" + pyB(v.ov) }; },
    },
  ];

  /** Run scenario i up to (and including) step k. hooks lets the UI mirror coordinator/station state. */
  function run(i, k, hooks) {
    const sc = SCENARIOS[i];
    hooks = hooks || {};
    const c = {
      z: null, now: 0, v: {}, result: null, draft: null, stationId: null, selected: null, highlight: null,
      coord(d) { c.draft = Object.assign({ stepFree: false, rest: false, water: false, wheel: false }, d); },
      station(id) { c.stationId = id; },
      select(id) { c.selected = id || null; },
      hl(id) { c.highlight = id; },
    };
    const last = Math.min(k === undefined ? sc.steps.length - 1 : k, sc.steps.length - 1);
    const checkAt = sc.checkAt === undefined ? sc.steps.length - 1 : sc.checkAt;
    for (let s = 0; s <= last; s++) {
      sc.steps[s].do(c);
      if (s === checkAt) {
        c.result = sc.check(c);
        const ref = PY_REFERENCE[i];
        c.result.refPass = ref.pass;
        c.result.refDetail = ref.detail;
        c.result.identical = ref.detail === c.result.detail && ref.pass === c.result.pass;
      }
    }
    return c;
  }

  function runAll() { return SCENARIOS.map((sc, i) => Object.assign({ n: sc.n, title: sc.title }, run(i).result)); }

  global.ZillScenarios = { SCENARIOS: SCENARIOS, PY_REFERENCE: PY_REFERENCE, run: run, runAll: runAll };
})(typeof window !== "undefined" ? window : globalThis);
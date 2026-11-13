"""Run the six proposed test scenarios against the rules prototype (synthetic data)."""
import json, sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from zill_engine import Zill, Group, demo_area

results = []
def check(name, cond, detail):
    results.append({"scenario": name, "pass": bool(cond), "detail": detail})

# 1. Ordinary request: group of 25 at G, no special needs
z = Zill(*demo_area())
g = Group("G-25", 25, "G")
opts, exc, manual = z.options(g, now=5)
top = opts[0]["station"] if opts else None
rid = z.request(g, top, now=5, eta_min=8)
z.respond(rid, "accept", now=6)
check("1 Ordinary request", top == "S2" and z.requests[rid]["state"] == "accepted",
      f"options={[o['station'] for o in opts]}, top={top}, excluded={exc}")

# 2. Nearest station full: S1 is 150 m away but has 2 places
check("2 Nearest station full", "S1" not in [o["station"] for o in opts]
      and any(e[0] == "S1" and "space" in e[1] for e in exc),
      f"S1 excluded: {[e for e in exc if e[0]=='S1']}")

# 3. Two groups request the same remaining space at S3 (30 free)
z = Zill(*demo_area())
ga, gb = Group("G-A", 20, "G"), Group("G-B", 20, "G")
z.st["S2"].status = "paused"; z.st["S2"].updated_at = 0   # force both toward S3
ra = z.request(ga, "S3", now=5, eta_min=10)
rb = z.request(gb, "S3", now=5, eta_min=10)
optsb, _, _ = z.options(gb, now=5)
check("3 Two groups, same space", ra and rb is None and "S3" not in [o["station"] for o in optsb],
      f"first={ra}, second={rb}; second group now offered {[o['station'] for o in optsb]}")

# 4. Group with wheelchair users needs step-free route; S2 only reachable via stairs
z = Zill(*demo_area())
gw = Group("G-W", 12, "G", needs_step_free=True)
optw, excw, _ = z.options(gw, now=5)
check("4 Accessible route", optw and optw[0]["station"] == "S3"
      and any(e[0] == "S2" and "route" in e[1] for e in excw),
      f"options={[o['station'] for o in optw]}, S2 reason={[e[1] for e in excw if e[0]=='S2']}")

# 5. Station closes after accepting a group
z = Zill(*demo_area())
g = Group("G-30", 30, "G")
rid = z.request(g, "S2", now=5, eta_min=8); z.respond(rid, "accept", now=6)
z.staff_update("S2", now=7, status="closed")
opts5, _, _ = z.options(g, now=7)
check("5 Station closes", z.requests[rid]["state"] == "station-closed"
      and "S2" not in [o["station"] for o in opts5] and len(opts5) > 0,
      f"request state={z.requests[rid]['state']}, new options={[o['station'] for o in opts5]}")

# 6. Stale info / no feasible option -> manual coordination
z = Zill(*demo_area())
for sid in ("S1", "S2", "S3", "S5"):
    z.st[sid].updated_at = -25                         # everything goes stale
opts6, exc6, manual6 = z.options(Group("G-40", 40, "G"), now=5)
check("6 Stale info -> manual", manual6 and not opts6
      and all("radio" in r or "closed" in r for _, r in exc6),
      f"manual={manual6}, reasons={exc6}")

# extra: request lapses without reply; no-show releases hold; override needs reason
z = Zill(*demo_area())
r = z.request(Group("G-15", 15, "G"), "S5", now=0, eta_min=10)
free_before = z.st["S5"].free(1)
z.expire(4)
lapsed = z.requests[r]["state"] == "lapsed" and z.st["S5"].free(4) == free_before + 15
r2 = z.request(Group("G-16", 16, "G"), "S5", now=4, eta_min=5); z.respond(r2, "accept", now=5)
z.expire(4 + 5 + 15 + 1)
noshow = z.requests[r2]["state"] == "no-show"
try:
    z.override("supervisor", "G-16", "send to S4", "", now=30); ov = False
except ValueError:
    ov = True
check("Extra: expiry, no-show, override reason", lapsed and noshow and ov,
      f"lapsed={lapsed}, no-show released={noshow}, override needs reason={ov}")

for r in results:
    print(("PASS " if r["pass"] else "FAIL ") + r["scenario"] + " | " + r["detail"])
json.dump(results, open(__file__.rsplit("/", 1)[0] + "/scenario_results.json", "w"), indent=1)
print(f"\n{sum(r['pass'] for r in results)}/{len(results)} passed")

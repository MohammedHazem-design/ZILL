"""
Illustrative comparison of station-selection policies on SYNTHETIC demand.

This is not evidence of real-world benefit. It checks whether, under stated
assumptions, capacity-aware confirmed allocation behaves differently from two
simple baselines. The result depends heavily on the assumption that station
staff keep occupancy current; a sensitivity case relaxes that.
"""
import random, json, statistics as st

# Synthetic area: one assembly point, 5 stations, approved-route walking distances (m)
STATIONS = {"S1": (150, 60), "S2": (500, 80), "S3": (700, 50), "S4": (300, 100), "S5": (800, 70)}
SPEED = 50                # m/min group pace (assumption)
HORIZON = 180             # minutes of demand
MEAN_GAP = 3.5            # mean minutes between group requests (Poisson); ~60% avg utilisation
SIZE = (8, 40)            # group size range
STAY = (20, 40)           # minutes spent at station
REPORT_EVERY = 15         # baseline B: capacity broadcast interval (radio/message)
RUNS = 300

def distance_between(a, b):
    return abs(STATIONS[a][0] - STATIONS[b][0])  # stations on one line (schematic)

def run(policy, seed, walkin_share=0.0, walkin_lag=10):
    rnd = random.Random(seed)
    t, groups = 0.0, []
    while t < HORIZON:
        t += rnd.expovariate(1 / MEAN_GAP)
        groups.append((t, rnd.randint(*SIZE), rnd.uniform(*STAY)))
    occ = {s: [] for s in STATIONS}                 # list of (leave_time, size)
    holds = {s: [] for s in STATIONS}               # (expire_time, size) — ZILL only
    reported = {s: 0 for s in STATIONS}; last_report = -1e9
    m = {"turned_away": 0, "extra_walk_m": [], "wait_min": [], "unplaced": 0, "n": 0}

    def load(s, now, known=False):
        # true load, or load as known to ZILL (walk-ins appear only after staff update)
        return sum(z for ar, lv, z, w in occ[s]
                   if lv > now and (not known or not w or ar + walkin_lag <= now))

    for (t0, size, stay) in groups:
        m["n"] += 1
        walkin = policy == "ZILL" and rnd.random() < walkin_share
        order = sorted(STATIONS, key=lambda s: STATIONS[s][0])
        if policy == "B_report" and t0 - last_report >= REPORT_EVERY:
            reported = {s: load(s, t0) for s in STATIONS}; last_report = t0
        # choose
        if policy == "A_nearest" or walkin:
            choice = order[0]
        elif policy == "B_report":
            ok = [s for s in order if STATIONS[s][1] - reported[s] >= size]
            choice = ok[0] if ok else order[0]
        else:  # ZILL: known load + live holds, whole group must fit
            ok = [s for s in order
                  if STATIONS[s][1] - load(s, t0, known=True)
                  - sum(z for e, z in holds[s] if e > t0) >= size]
            if not ok:
                m["unplaced"] += 1                     # -> manual coordination prompt
                choice = None
            else:
                choice = ok[0]
                eta = t0 + 2 + STATIONS[choice][0] / SPEED  # 2 min confirmation
                holds[choice].append((eta + 0.01, size))
        if choice is None:
            continue
        # walk and arrive; if full on arrival, walk on to next station with real space
        now = t0 + (2 if policy == "ZILL" and not walkin else 0) + STATIONS[choice][0] / SPEED
        walked, cur, tried = STATIONS[choice][0], choice, {choice}
        while STATIONS[cur][1] - load(cur, now) < size:
            m["turned_away"] += 1
            nxt = [s for s in order if s not in tried]
            if not nxt:
                # wait outside nearest-full station until space (worst case)
                frees = sorted(lv for ar, lv, z, w in occ[cur] if lv > now)
                wait = 0
                while STATIONS[cur][1] - load(cur, now + wait) < size and frees:
                    wait = frees.pop(0) - now
                m["wait_min"].append(wait); now += wait
                break
            n = min(nxt, key=lambda s: distance_between(cur, s))
            walked += distance_between(cur, n); now += distance_between(cur, n) / SPEED
            cur = n; tried.add(cur)
        occ[cur].append((now, now + stay, size, walkin))
        m["extra_walk_m"].append(walked - STATIONS[order[0]][0])
    return m

def summarise(policy, **kw):
    agg = {"turned_away_per_100": [], "mean_extra_walk_m": [], "unplaced_per_100": []}
    for seed in range(RUNS):
        r = run(policy, seed, **kw)
        agg["turned_away_per_100"].append(100 * r["turned_away"] / r["n"])
        agg["mean_extra_walk_m"].append(st.mean(r["extra_walk_m"]) if r["extra_walk_m"] else 0)
        agg["unplaced_per_100"].append(100 * r["unplaced"] / r["n"])
    return {k: round(st.mean(v), 1) for k, v in agg.items()}

if __name__ == "__main__":
    out = {
        "A: nearest station, no capacity info": summarise("A_nearest"),
        f"B: last capacity report every {REPORT_EVERY} min": summarise("B_report"),
        "ZILL rules: live updates + confirmed holds": summarise("ZILL"),
        "ZILL sensitivity: 30% walk-ins, logged 10 min late": summarise("ZILL", walkin_share=0.3),
        "ZILL sensitivity: 60% walk-ins, logged 10 min late": summarise("ZILL", walkin_share=0.6),
    }
    for k, v in out.items():
        print(f"{k:55s} {v}")
    json.dump({"assumptions": {"stations(dist_m,capacity)": STATIONS, "speed_m_min": SPEED,
               "horizon_min": HORIZON, "mean_gap_min": MEAN_GAP, "group_size": SIZE,
               "stay_min": STAY, "report_every_min": REPORT_EVERY, "runs": RUNS},
               "results": out}, open("simulation_results.json", "w"), indent=1)

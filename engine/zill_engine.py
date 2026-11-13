"""
ZILL — ظل : rules-based coordination prototype (synthetic data only).

This is a demonstration of the proposed operational rules. All stations, routes,
groups and timings are fictional. Nothing here is connected to any real Hajj
system, map or authority data.
"""
from __future__ import annotations
import heapq
from dataclasses import dataclass, field

# ---- Operating assumptions (to be validated with operators) -----------------
FRESH_MIN = 10          # capacity updated within 10 min  -> shown as "updated N min ago"
STALE_MIN = 20          # older than 20 min -> not offered; manual coordination prompt
REQUEST_TIMEOUT_MIN = 3 # station must answer within 3 min or the request lapses
NO_SHOW_GRACE_MIN = 15  # accepted hold released 15 min after the stated ETA
WALK_M_PER_MIN = 50     # conservative group walking pace for estimates (assumption)


@dataclass
class Station:
    id: str
    name: str
    node: str
    capacity: int
    occupancy: int
    services: set
    step_free: bool
    status: str = "open"            # open | paused | closed
    updated_at: int = 0             # minute of last staff update
    holds: dict = field(default_factory=dict)   # request_id -> (size, expires_at, kind)

    def held(self, now):
        return sum(s for s, exp, _ in self.holds.values() if exp > now)

    def free(self, now):
        return self.capacity - self.occupancy - self.held(now)

    def age(self, now):
        return now - self.updated_at


@dataclass
class Edge:
    a: str
    b: str
    metres: int
    status: str = "approved"        # approved | closed | unverified
    step_free: bool = True


@dataclass
class Group:
    id: str
    size: int
    node: str
    needs_step_free: bool = False
    needs: set = field(default_factory=lambda: {"cooling"})


class Zill:
    def __init__(self, stations, edges):
        self.st = {s.id: s for s in stations}
        self.edges = edges
        self.log = []
        self._req = 0
        self.requests = {}

    # -- routing: only approved, open segments; step-free if the group needs it
    def walk(self, src, dst, step_free):
        adj = {}
        for e in self.edges:
            if e.status != "approved":
                continue
            if step_free and not e.step_free:
                continue
            adj.setdefault(e.a, []).append((e.b, e.metres))
            adj.setdefault(e.b, []).append((e.a, e.metres))
        dist, pq = {src: 0}, [(0, src)]
        while pq:
            d, n = heapq.heappop(pq)
            if n == dst:
                return d
            if d > dist.get(n, 1e18):
                continue
            for m, w in adj.get(n, []):
                if d + w < dist.get(m, 1e18):
                    dist[m] = d + w
                    heapq.heappush(pq, (d + w, m))
        return None

    def expire(self, now):
        for s in self.st.values():
            for rid in [r for r, (_, exp, _) in s.holds.items() if exp <= now]:
                kind = s.holds[rid][2]
                del s.holds[rid]
                req = self.requests.get(rid)
                if req and req["state"] in ("pending", "accepted"):
                    req["state"] = "lapsed" if kind == "pending" else "no-show"
                    self.log.append((now, rid, req["state"]))

    def options(self, g: Group, now):
        """Return (feasible options, excluded-with-reason, manual_prompt)."""
        self.expire(now)
        feasible, excluded = [], []
        for s in self.st.values():
            why = None
            if s.status != "open":
                why = f"{s.status}"
            elif s.age(now) > STALE_MIN:
                why = f"info {s.age(now)} min old — confirm by radio"
            elif not g.needs <= s.services:
                why = "service not offered"
            elif g.needs_step_free and not s.step_free:
                why = "no step-free entry"
            elif s.free(now) < g.size:
                why = f"space {max(s.free(now),0)} < group {g.size} (not split)"
            else:
                m = self.walk(g.node, s.node, g.needs_step_free)
                if m is None:
                    why = "no approved" + (" step-free" if g.needs_step_free else "") + " route"
                else:
                    feasible.append({
                        "station": s.id, "metres": m,
                        "walk_min": round(m / WALK_M_PER_MIN),
                        "free": s.free(now), "updated_min_ago": s.age(now),
                        "why": f"{s.free(now)} places, {m} m on approved route, "
                               f"updated {s.age(now)} min ago",
                    })
            if why:
                excluded.append((s.id, why))
        feasible.sort(key=lambda o: (o["metres"], o["updated_min_ago"], -o["free"]))
        manual = not feasible
        return feasible, excluded, manual

    def request(self, g: Group, station_id, now, eta_min):
        """Coordinator sends request. Server serialises: a provisional hold is
        placed only if the whole group still fits."""
        self.expire(now)
        s = self.st[station_id]
        if s.status != "open" or s.free(now) < g.size:
            self.log.append((now, g.id, f"request to {station_id} refused: no space"))
            return None
        self._req += 1
        rid = f"R{self._req}"
        s.holds[rid] = (g.size, now + REQUEST_TIMEOUT_MIN, "pending")
        self.requests[rid] = {"group": g.id, "station": station_id, "size": g.size,
                              "state": "pending", "eta": now + eta_min}
        self.log.append((now, rid, f"pending at {station_id} for {g.id} ({g.size})"))
        return rid

    def respond(self, rid, decision, now, reason=""):
        self.expire(now)
        req = self.requests[rid]
        s = self.st[req["station"]]
        if req["state"] != "pending":
            return req["state"]
        if decision == "accept":
            s.holds[rid] = (req["size"], req["eta"] + NO_SHOW_GRACE_MIN, "accepted")
            req["state"] = "accepted"
        else:  # decline | coordinate
            s.holds.pop(rid, None)
            req["state"] = decision
        self.log.append((now, rid, f"{req['state']} {reason}".strip()))
        return req["state"]

    def arrive(self, rid, now):
        req = self.requests[rid]
        s = self.st[req["station"]]
        s.holds.pop(rid, None)
        s.occupancy += req["size"]
        s.updated_at = now
        req["state"] = "arrived"
        self.log.append((now, rid, "arrived"))

    def staff_update(self, station_id, now, occupancy=None, status=None):
        s = self.st[station_id]
        if occupancy is not None:
            s.occupancy = occupancy
        if status is not None:
            s.status = status
            if status != "open":
                for rid in list(s.holds):
                    if self.requests[rid]["state"] in ("pending", "accepted"):
                        self.requests[rid]["state"] = "station-closed"
                        self.log.append((now, rid, "station closed — coordinator re-plans"))
                s.holds.clear()
        s.updated_at = now

    def override(self, who, rid_or_group, action, reason, now):
        if not reason:
            raise ValueError("override needs a recorded reason")
        self.log.append((now, rid_or_group, f"OVERRIDE by {who}: {action} — {reason}"))


# ---- Synthetic demo area ---------------------------------------------------
def demo_area():
    stations = [
        Station("S1", "Station 1 (synthetic)", "A", capacity=60, occupancy=58,
                services={"cooling", "water", "rest"}, step_free=True, updated_at=0),
        Station("S2", "Station 2 (synthetic)", "C", capacity=80, occupancy=40,
                services={"cooling", "water", "rest"}, step_free=True, updated_at=0),
        Station("S3", "Station 3 (synthetic)", "D", capacity=50, occupancy=20,
                services={"cooling", "water", "rest", "wheelchair-seating"},
                step_free=True, updated_at=0),
        Station("S4", "Station 4 (synthetic)", "E", capacity=100, occupancy=30,
                services={"cooling", "water"}, step_free=True, updated_at=-30),  # stale
        Station("S5", "Station 5 (synthetic)", "F", capacity=70, occupancy=35,
                services={"cooling", "water", "rest"}, step_free=True, updated_at=0),
    ]
    edges = [
        Edge("G", "A", 150), Edge("A", "B", 200),
        Edge("B", "C", 150, step_free=False),           # stairs: not wheelchair-accessible
        Edge("B", "D", 350), Edge("G", "E", 300),
        Edge("G", "F", 250, status="closed"),           # closed route
        Edge("E", "F", 500), Edge("D", "F", 300),
    ]
    return stations, edges

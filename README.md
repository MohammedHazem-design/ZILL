# ZILL ظل

**Rules-based coordination for Hajj cooling and assistance stations**
Team ZILL · MEDATHON (SYHF 2026) Filter 2 · Team code MED-VSPPAX · Track 1: Healthcare Crowd & Patient Flow Management · Batterjee Medical College, Jeddah

> **Status: working prototype on synthetic data.** The web app and its rules engine run, and 7 scripted test scenarios pass. There are **no real users, operator partner, pilot site or real data yet**. All stations, routes, groups and times are synthetic; the map is schematic and fictional, not a real Hajj map.

**▶ Live prototype:** **https://mohammedhazem-design.github.io/ZILL/** · **Filter 2 deck:** [`submission/MED-VSPPAX_TeamZILL_Filter2.pdf`](submission/MED-VSPPAX_TeamZILL_Filter2.pdf)

## The problem

In Hajj heat, a field team moving a tired group to a cooling or assistance station often cannot tell, before walking, whether the station has room for the **whole group**, whether the approved path is **step-free**, or whether the station **expects them**. A wasted walk to a full or unsuitable station means more time in the heat. Evidence and sources are in the deck.

## The idea

ZILL answers one question: *which appropriate station can receive this group, and has the receiving team confirmed?* It sends a group only to a station that has room for everyone, suits its access needs, is on an operator-approved route, and has confirmed it will receive them.

Flow: **Coordinator requests → Station accepts / declines / "call me" → Accepted group counts against space at once → Supervisor sees everything**

Five fixed rules, applied in order (**no AI in allocation**, so every suggestion can be explained):
1. Route approved and open; step-free if the group needs it
2. Station open; data no older than 20 minutes
3. Station offers the services needed
4. Whole group fits: `capacity − inside − accepted − pending ≥ group size`. Never split.
5. Rank by walking distance, then data freshness

## What is in this repository

| Path | What it is | Status |
|---|---|---|
| `index.html`, `css/`, `js/` | Web app: coordinator phone, station tablet, supervisor desktop and area map, sharing one live state; Scenario Lab; Evidence page | **Built, runs** (open `index.html` in any browser, no install) |
| `js/engine.js` | Rules engine, line-for-line JavaScript port of the Python engine | **Built, tested** |
| `engine/zill_engine.py` | Original rules engine (Python 3, standard library) | **Built, tested** |
| `engine/run_scenarios.py` | 7 scripted test scenarios | **7/7 pass** |
| `tests/check_parity.py` | Proves the browser engine reproduces the Python output exactly | **7/7 identical** |
| `engine/simulate.py` | Baseline comparison on synthetic demand (300 runs) | Illustrative only |
| `submission/` | Filter 2 deck (PDF) and a step-by-step scenario replay (PDF) | Complete |
| Field deployment, shared server, Arabic UI | - | **Not built** |

## What is tested vs. not

**Tested (we ran it and it passed):** all 7 scripted scenarios: ordinary request, nearest station full (group never split), two groups competing for the same space (first hold wins), step-free routing, station closing after accepting, stale data leading to manual coordination, and expiry / no-show / override needing a reason. The Python and browser engines produce character-for-character identical results.

**Illustrative (synthetic simulation, not evidence of benefit):** groups arriving at a full station fell from 101 to 0 per 100 versus a 15-minute radio report, **but the benefit disappears when walk-ins are not logged.**

**Not tested:** real coordinators and station staff, real demand, the 3 / 15 / 20-minute limits, usability at peak, connectivity, any health outcome.

## Try it (2 minutes)

1. Open the live prototype (or `index.html`) → **Live demo**.
2. On the phone, tap **Request arrival at S2**. On the tablet, tap **Accept**. Watch the phone confirm and the group walk on the map.
3. Open **Scenario Lab** → **Run all 7 instantly** → *7/7 pass · 7/7 identical to the Python engine*.

Re-run the tests yourself: `python engine/run_scenarios.py` and `python tests/check_parity.py`.

## Next steps (proposed success criteria)

1. Interviews with 8–12 coordinators and station staff
2. Staff usability test: log an arrival in ≤ 3 s; ≥ 90% of walk-ins logged within 2 min
3. Validate the time limits and route data with operators
4. Field-ready build: Arabic-first UI, shared state service, SMS fallback, clinical-safety and data-protection review
5. Small controlled pilot with an authorised operator, measuring waiting and unnecessary walking

## Safety and privacy

- **Not triage or diagnosis.** The coordinator screen starts with: *"Suspected medical emergency? Use the emergency procedure now — do not book a station."*
- No names, medical histories or location tracking: anonymous group size and approximate point only.
- An accepted request is not a guaranteed admission and must never delay urgent help.
- Never suggests a closed, prohibited or unverified route; never shows stale data as live.
- Overrides need a recorded reason and go into an append-only log.

## Team

Hasan Ali Ahmed Haneef (Group Leader) · Mohammed Hazem Sabir Muqadam · Bilal Abdul Qayyum · Yahiya Khan. General Medicine, Batterjee Medical College, Jeddah.

AI tools assisted with research, drafting, design and coding; the team is responsible for this submission. No AI is used inside ZILL. No partnership with, or integration into, any authority or existing system (e.g. Nusuk, the Monitoring and Control Center) exists or is implied.
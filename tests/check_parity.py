"""
Parity check: proves the Python reference strings embedded in js/scenarios.js
are exactly what the original Python engine prints today.

    py tests/check_parity.py        (Windows)
    python3 tests/check_parity.py   (macOS / Linux)

Chain of evidence:
  engine/run_scenarios.py  --(this script)-->  PY_REFERENCE in js/scenarios.js
  PY_REFERENCE  --(Scenario Lab "Run all 7")-->  browser JS engine output
Synthetic data only.
"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENGINE = ROOT / "engine"

out = subprocess.run([sys.executable, "run_scenarios.py"], cwd=ENGINE,
                     capture_output=True, text=True, encoding="utf-8").stdout
py = {}
for line in out.splitlines():
    m = re.match(r"^(PASS|FAIL) (.+?) \| (.*)$", line)
    if m:
        py[m.group(2)] = (m.group(1) == "PASS", m.group(3))

js_src = (ROOT / "js" / "scenarios.js").read_text(encoding="utf-8")
ref = {}
for m in re.finditer(r'\{ scenario: "(.+?)", pass: (true|false), detail: ("(?:[^"\\]|\\.)*") \}', js_src):
    ref[m.group(1)] = (m.group(2) == "true", json.loads(m.group(3)))

ok = True
for name, (p, d) in py.items():
    r = ref.get(name)
    same = r is not None and r == (p, d)
    ok &= same and p
    print(("OK   " if same else "DIFF ") + ("PASS " if p else "FAIL ") + name)
    if not same:
        print("     python :", d)
        print("     js ref :", r and r[1])
print()
print(f"{len(py)} Python scenarios, {sum(1 for n in py if ref.get(n) == py[n])} match the browser reference exactly.")
sys.exit(0 if ok and len(py) == 7 and len(ref) == 7 else 1)
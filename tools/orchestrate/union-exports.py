"""Resolve git conflict hunks whose both sides contain only `export ...` lines by keeping both (union, no duplicates).
Exit 0 if every hunk in the file was resolved, 1 otherwise (file left untouched)."""
import re, sys
p = sys.argv[1]; s = open(p).read()
ok = True
def fix(m):
    global ok
    a, b = m.group(1).splitlines(), m.group(2).splitlines()
    if not all(l.startswith("export ") or not l.strip() for l in a + b): ok = False; return m.group(0)
    out = [];  [out.append(l) for l in a + b if l.strip() and l not in out]
    return "\n".join(out) + "\n"
r = re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", fix, s, flags=re.S)
if ok and "<<<<<<<" not in r: open(p, "w").write(r); sys.exit(0)
sys.exit(1)

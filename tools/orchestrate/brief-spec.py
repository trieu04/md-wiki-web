"""Print the spec for a task ID from docs/implementation-plan.md, expanding merged tasks (docs/tasks/merges.tsv, D-30)."""
import re, sys
tid = sys.argv[1]
plan = open("docs/implementation-plan.md").read().splitlines()
merges = {}
for line in open("docs/tasks/merges.tsv"):
    if line.startswith("#") or not line.strip(): continue
    f = line.rstrip("\n").split("\t")
    merges[f[0]] = dict(parts=f[1].split(","), impl=f[2], rev=f[3], deps=f[4], title=f[5])

def section(old):
    # 1) a "#### <ID> " section
    for i, l in enumerate(plan):
        if l.startswith(f"#### {old} "):
            out = [l]
            for m in plan[i + 1:]:
                if re.match(r"^#{2,4} ", m): break
                out.append(m)
            return "\n".join(out).rstrip()
    # 2) a row in a phase spec table (Phases 2-3): include the phase's "Common" paragraph and table header
    for i, l in enumerate(plan):
        if l.startswith(f"| {old} |") and i > 0 and any(p.startswith("## 4.") for p in plan[:i]) :
            j = i
            while j > 0 and plan[j - 1].startswith("|"): j -= 1
            hdr = plan[j:j + 2]
            k = j
            while k > 0 and not plan[k - 1].startswith("### "): k -= 1
            common = [p for p in plan[k:j] if p.startswith("Common")]
            return "\n".join([f"#### {old}", *common, "", *hdr, l])
    return f"#### {old}\n(no spec section found — report BLOCKED)"

if tid in merges:
    m = merges[tid]
    print(f"#### {tid} {m['title']} — {m['impl']} (reviewer {m['rev']}; deps {m['deps']})")
    print(f"This task merges {', '.join(m['parts'])} (D-30: fewer, larger tasks). Deliver every part below in one change; "
          "every part's files, acceptance criteria and tests apply.\n")
    for p in m["parts"]:
        print(section(p).replace("#### ", "##### Part: ", 1)); print()
else:
    print(section(tid))

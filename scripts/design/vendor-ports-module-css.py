"""Vendor the Ports-module design CSS into components/pda/ports-module.css (owner B2ALL-061, design fidelity).

Reads the stylesheets extracted from `tmp/Arab ShipBroker Portal - Standalone (7).html` and prefixes every selector with
`.pm-scope`, so the design's classes apply only inside the Ports-module pages and never collide with the portal.
:root/html/body become `.pm-scope` itself; @media/@supports/@container blocks are prefixed inside; @keyframes and
@font-face is never copied (the app serves Inter itself). The design's token file and icon font are NOT vendored: the app already provides those tokens
(app/design-tokens.css). The design-system base and da-plus are vendored first, scoped like the rest. Re-run to regenerate; never hand-edit
the output.

    python scripts/design/vendor-ports-module-css.py [<dir with the extracted *.css> [components/pda/ports-module.css]]

The inputs are tracked under design/ports-module/src (the default); the output carries no trailing whitespace, so a
re-run on a clean tree is a no-op (C2ALL-164 P2-4).
"""
import re
import sys
from pathlib import Path

SOURCES = [  # (file in the extract dir, design path) in cascade order: shared vocabulary first, page CSS, responsive last
    ("ports-cost-estimator_4.css", "design-system base (buttons, titles, chips)"),
    ("ports-cost-estimator_2.css", "da-calculator/da-plus.css"),
    ("attending-agent_4.css", "da-calculator/port-details.css"),
    ("port-settings_5.css", "da-calculator/pda-estimator.css"),
    ("ports-cost-estimator_6.css", "da-calculator/pda-face.css"),
    ("ports-cost-estimator_13.css", "da-calculator/pda-soft.css"),
    ("ports-cost-estimator_11.css", "da-calculator/ports-index.css"),
    ("agent-portal_4.css", "da-calculator/agent-portal.css"),
    ("port-particulars_5.css", "da-calculator/port-dossier.css"),
    ("port-particulars_6.css", "da-calculator/port-particulars.css"),
    ("port-particulars_7.css", "da-calculator/harbour-master.css"),
    ("port-settings_6.css", "da-calculator/port-settings.css"),
    ("port-directory_5.css", "da-calculator/port-tariff.css"),
    ("ports-map_8.css", "da-calculator/ports-map.css"),
    ("tariff-packs_6.css", "da-calculator/tariff-packs.css"),
    ("tariff-layouts_6.css", "da-calculator/tariff-layouts.css"),
    ("port-settings_7.css", "da-calculator/verify-panel.css"),
    ("port-module_5.css", "port-module (page-local)"),
    ("agent-portal_6.css", "da-calculator/ports-responsive.css"),
]
SCOPE = ".pm-scope"
TOKENS = """/* module-local tokens the app does not define (values from the design's own CSS) */
.pm-scope {
  --ccx-amber: #B17311; --ccx-blue: var(--asb-blue); --ccx-card: #FFFFFF; --ccx-faint: #9AA7BD; --ccx-green: #2A9962;
  --ccx-ink: #1A2330; --ccx-line: #DDE5F0; --ccx-line2: #EDF1F8; --ccx-navy: var(--asb-navy); --ccx-red: #C84A4A;
  --ccx-slate: #6B7A99; --ccx-soft: #F2F6FB;
  --pf-sh: 0 1px 2px rgba(13,37,69,.05),0 4px 16px rgba(13,37,69,.05);
}
"""


def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def prefix_selector(sel: str) -> str:
    sel = sel.strip()
    if not sel:
        return sel
    if re.match(r"^(:root|html|body)\b", sel):
        rest = re.sub(r"^(:root|html|body)", "", sel).strip()
        return f"{SCOPE}{(' ' + rest) if rest and not rest.startswith(':') else rest}"
    if sel.startswith(SCOPE):
        return sel
    return f"{SCOPE} {sel}"


def split_top(css: str):
    """Yield (prelude, body) for each top-level block; body is None for statements like @import."""
    i, n = 0, len(css)
    while i < n:
        j = i
        while j < n and css[j] not in "{;":
            j += 1
        if j >= n:
            break
        prelude = css[i:j].strip()
        if css[j] == ";":
            yield prelude, None
            i = j + 1
            continue
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]
        i = k


def scope(css: str) -> str:
    out = []
    for prelude, body in split_top(css):
        if body is None:
            if prelude.startswith("@import") or prelude.startswith("@charset"):
                continue
            out.append(prelude + ";")
        elif prelude.startswith(("@media", "@supports", "@container", "@layer")):
            out.append(prelude + " {\n" + scope(body) + "\n}")
        elif prelude.startswith("@font-face"):
            # never vendored: @font-face cannot be scoped, the app already serves Inter, and the bundle's asset-id
            # url()s do not exist here (they would break the global family and the Next CSS build)
            continue
        elif prelude.startswith(("@keyframes", "@-webkit-keyframes", "@page")):
            out.append(prelude + " {" + body + "}")
        else:
            sels = ", ".join(prefix_selector(s) for s in prelude.split(","))
            out.append(sels + " {" + body.strip() + "}")
    return "\n".join(out)


REPO = Path(__file__).resolve().parents[2]
DEFAULT_SRC = REPO / "design" / "ports-module" / "src"
DEFAULT_DEST = REPO / "components" / "pda" / "ports-module.css"


def main(src_dir: str, dest: str) -> None:
    parts = ["/* GENERATED by scripts/design/vendor-ports-module-css.py from the approved standalone design (owner B2ALL-061).",
             "   Every selector is scoped to .pm-scope. Do not edit by hand: change the generator or the design, then re-run. */",
             TOKENS]
    for name, label in SOURCES:
        css = Path(src_dir, name).read_text(encoding="utf8")
        parts.append(f"\n/* ── {label} ── */\n" + scope(strip_comments(css)))
    text = re.sub(r"[ \t]+$", "", "\n".join(parts) + "\n", flags=re.M)  # whitespace-clean: git diff --check stays quiet
    Path(dest).write_text(text, encoding="utf8", newline="\n")
    print(f"wrote {dest}: {sum(1 for _ in Path(dest).open(encoding='utf8'))} lines from {len(SOURCES)} sources")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(DEFAULT_SRC), sys.argv[2] if len(sys.argv) > 2 else str(DEFAULT_DEST))

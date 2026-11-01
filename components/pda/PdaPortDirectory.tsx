// The design's Port Directory (owner B2ALL-061, build step 11): every active, verified port, ranked by the live
// listings that touch it today, with search, zone chips and sortable columns — all server-rendered through the URL.
// Physical limits, congestion and an indicative DA are not recorded yet and say so; the tariff column reads the
// tariffs in force from the Ports workspace.
import Link from "next/link";
import { ArrowLeft, ChevronRight, Map as MapIcon, Search } from "lucide-react";

import { TOUCH_ROLE_LABEL, filterDirectory, targetedCount, touchRole, type PdaPortCensus, type PortSortKey } from "@/lib/pda/port-census";

import "./pda-route-estimator.css";
import "./ports-module.css";

const NR = "Not recorded yet";
const COLUMNS: Array<{ key: PortSortKey; label: string }> = [{ key: "rank", label: "Targeting" }, { key: "name", label: "Port" }, { key: "country", label: "Country" }, { key: "zone", label: "Zone" }];
const ROLE_MARK = { load: "▲", discharge: "▼", both: "⇅", vessels: "●", none: "", suppressed: "", touched: "◆" } as const;

export function PdaPortDirectory({ census, tariffHeld, query, zone, sort, desc, on }: {
  census: PdaPortCensus;
  tariffHeld: ReadonlySet<string>;
  query: string;
  zone: string | null;
  sort: PortSortKey;
  desc: boolean;
  on: string;
}) {
  const rows = filterDirectory(census, query, zone, sort, desc);
  const zones = [...new Set(census.ports.map((p) => p.zone).filter((z): z is string => !!z))].sort();
  const href = (patch: Partial<{ q: string; zone: string | null; sort: PortSortKey; desc: boolean }>) => {
    const p = new URLSearchParams();
    const q = patch.q ?? query; if (q) p.set("q", q);
    const z = patch.zone === undefined ? zone : patch.zone; if (z) p.set("zone", z);
    const s = patch.sort ?? sort; if (s !== "rank") p.set("sort", s);
    const d = patch.desc ?? desc; if (d) p.set("desc", "1");
    if (on) p.set("on", on);
    const qs = p.toString();
    return `/dashboard/ports-da/directory${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href={`/dashboard/ports-da/map?on=${on}`}><MapIcon size={15} aria-hidden="true" /> Map view</Link>
        <nav className="pd-crumbs" aria-label="Breadcrumb">Ports Module · <b>Port Directory</b></nav>
        <div className="pd-topbar__end"><Link className="asb-btn pd-topbar__link" href="/dashboard/ports-da/hub"><ArrowLeft size={13} aria-hidden="true" /> Ports Module</Link></div>
      </div>

      <div className="pd-band pd-band--navy">
        <div className="pd-band__ey">Ports Module</div>
        <h1 className="pd-band__title">Port Directory</h1>
        <p className="pd-band__sub">{targetedCount(census)} port{targetedCount(census) === 1 ? "" : "s"} touched by live listings today · {census.ports.length} in network · ranked by touches; a port touched by fewer than {census.minimumCohort} listings shows no count.</p>
        <form className="pt-ctl" method="get" action="/dashboard/ports-da/directory">
          <label className="pt-search"><Search size={14} aria-hidden="true" /><span className="asb-sr-only">Search ports</span>
            <input className="pt-text" type="search" name="q" defaultValue={query} placeholder="Search port, LOCODE, country…" /></label>
          {zone ? <input type="hidden" name="zone" value={zone} /> : null}
          {sort !== "rank" ? <input type="hidden" name="sort" value={sort} /> : null}
          {desc ? <input type="hidden" name="desc" value="1" /> : null}
          <button type="submit" className="asb-btn">Search</button>
        </form>
        <div className="pd-chips" aria-label="Zones">
          <Link className={`pd-chip${zone ? "" : " is-on"}`} href={href({ zone: null })} aria-current={zone ? undefined : "true"}>All zones</Link>
          {zones.map((z) => <Link key={z} className={`pd-chip${zone === z ? " is-on" : ""}`} href={href({ zone: z })} aria-current={zone === z ? "true" : undefined}>{z}</Link>)}
        </div>
      </div>

      <div className="pd-panel pt-wrap">
        <div className="px-scrollx">
          <table className="pt-lines">
            <caption className="asb-sr-only">Ports, ranked by the live listings that touch them</caption>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort === c.key ? (desc ? "descending" : "ascending") : "none"}>
                    <Link href={href({ sort: c.key, desc: sort === c.key ? !desc : false })} className="pt-sort">{c.label}{sort === c.key ? (desc ? " ▾" : " ▴") : ""}</Link>
                  </th>
                ))}
                <th scope="col">Congestion</th>
                <th scope="col">Indicative DA</th>
                <th scope="col">Tariff</th>
                <th scope="col"><span className="asb-sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={8} className="pt-empty">No port matches this search.</td></tr> : rows.map((p) => {
                const role = touchRole(p);
                return (
                  <tr key={p.locode}>
                    <td className="pt-rank">
                      {p.rank != null ? <span className="pt-rank__n" title={`${p.touches} touches · ${TOUCH_ROLE_LABEL[role]}`}>#{p.rank} <span aria-hidden="true">{ROLE_MARK[role]}</span><span className="asb-sr-only"> {TOUCH_ROLE_LABEL[role]}</span></span>
                        : p.suppressed ? <span className="pt-rank__few" title="Touched by fewer than the cohort minimum; the count is withheld">fewer than {census.minimumCohort}</span>
                        : <span className="ap-none">no live listing</span>}
                    </td>
                    <th scope="row">
                      <div className="pt-li__label">{p.name}<span className="pt-li__code">{p.locode}</span></div>
                      <div className="pt-li__basis">physical limits {NR.toLowerCase()}</div>
                    </th>
                    <td>{p.country ?? <span className="ap-none">–</span>}</td>
                    <td>{p.zone ? <span className="pd-chip pd-chip--zone">{p.zone}</span> : <span className="ap-none">–</span>}</td>
                    <td><span className="ap-none">{NR}</span></td>
                    <td><span className="ap-none">{NR}</span></td>
                    <td>{tariffHeld.has(p.locode) ? <span className="pt-tariff is-held">held</span> : <span className="pt-tariff">none</span>}</td>
                    <td><Link className="pt-open" href={`/dashboard/ports-da/ports/${p.locode}?on=${on}`} aria-label={`Open the record of ${p.name}`}><ChevronRight size={16} aria-hidden="true" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="tp-note">Targeting is read from the live, approved listings on the market boards today (loads ▲, discharges ▼, both ⇅, open vessels ●), never typed. Congestion, an indicative DA and the physical limits of a port are not recorded yet; the port record says so slot by slot.</p>
      </div>
    </div>
  );
}

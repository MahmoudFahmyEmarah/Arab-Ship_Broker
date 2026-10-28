// The design's Tariff Layouts reference (owner B2ALL-061, build step 12): the atlas of tariff shapes. Section 01 shows
// the two shapes without figures; section 05 lists which port is priced by which pack, as published today, and says
// that the shape is not derived yet; sections 02–04 and 06–07 need a bundled pack whose data is not held and say so.
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import type { PdaTariffPack } from "@/lib/pda/tariff-packs";
import { resolvePdaTariffPorts, packCount } from "@/lib/pda/tariff-packs";

import "./pda-route-estimator.css";
import "./ports-module.css";

const NR = "Not recorded yet";

const ITEMISED = [
  ["Port dues", "per GT or NT, per call", ["Measured on the ship's tonnage", "One line, one basis"]],
  ["Pilotage", "in and out, per movement", ["Compulsory where the port says so", "Often banded by GT"]],
  ["Towage", "per tug, per movement", ["The estimate is only as good as the tug count"]],
  ["Mooring and unmooring", "per operation", ["Gang hire where the port provides it"]],
  ["Berth hire", "per metre LOA per day", ["Starts the clock the ship is alongside"]],
  ["Agency", "per call", ["Quoted by the attending agent, never a tariff line"]],
] as const;

const BUNDLED = [
  ["Port dues", "per GT, then per GT per day after an allowance", ["Days 0–N at the first rate, each further day or part at the second", "Carries berth occupancy: there is no separate berth hire"]],
  ["Berth hire", "a genuine zero, not a sourcing gap", ["The bundle above already covers it"]],
  ["Cargo handling", "per tonne, reserved to the authority", ["A tariff line, not an agent quote, where the authority stevedores"]],
  ["Overflow and detention", "per hour, on top", ["Tug and pilot hours beyond the allowance: the exposure sits in the hours, not the rate"]],
] as const;

const SECTIONS = [
  { n: "02", title: "The rate is chosen by what the ship carries", what: "Needs a bundled pack: the commodity bands that pick the rate are not held as data." },
  { n: "03", title: "What the single figure covers — and where it stops", what: "Needs a bundled pack: the inclusion clause is not held as data." },
  { n: "04", title: "Worked call — what the shape costs", what: "No worked example is shown without a bundled pack; the estimator prices a real call from the tariff in force." },
  { n: "06", title: "The hours that set the days", what: "Working hours, overtime and allowance clauses are not held as data for any pack." },
  { n: "07", title: "Findings to put to the authority", what: "No finding has been raised against a pack yet." },
] as const;

export function PdaTariffLayouts({ packs, on }: { packs: PdaTariffPack[]; on: string }) {
  const resolver = resolvePdaTariffPorts(packs);
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href={`/dashboard/ports-da/tariff-packs?on=${on}`}><ArrowLeft size={15} aria-hidden="true" /> Tariff Packs</Link>
        <nav className="pd-crumbs" aria-label="Breadcrumb">Ports Module · Tariff data · <b>Tariff Layouts</b></nav>
        <div className="pd-topbar__end"><span className="pdr-role">Reference</span></div>
      </div>

      <div className="pd-band pd-band--navy">
        <div className="pd-band__ey">Ports Module · 1st arm · tariff structure</div>
        <h1 className="pd-band__title">Tariff Layouts</h1>
        <p className="pd-band__sub">Not every port bills the same shape. The engine is one; the layouts are several. This is the atlas: what each shape is, and which published pack prices which port today.</p>
        <div className="pd-band__badges">
          <span className="pd-badge"><span className="dot" aria-hidden="true"></span>{packs.length} pack{packs.length === 1 ? "" : "s"} published and in force on {on}</span>
          <span className="pd-badge"><ShieldCheck size={13} aria-hidden="true" /> shapes not derived yet</span>
        </div>
      </div>

      <div className="tl-wrap">
        <p className="tl-lede">The DA model was written against an <b>itemised</b> marine layer: dues, then pilotage, then tugs, then mooring, then berth hire, each on its own basis. Some authorities publish a <b>bundled</b> shape instead: one figure on the ship&apos;s tonnage that carries the berth, with the exposure sitting in the hours beyond an allowance. The pack record holds the lines as published; the shape of each pack is not derived from them yet, so this page shows the shapes without figures.</p>

        <section className="tl-sec" aria-labelledby="tl-01">
          <div className="tl-sec__h"><span className="tl-sec__n">01</span><h2 id="tl-01" className="tl-sec__t">The two shapes, side by side</h2><span className="tl-sec__x">Same call, same vessel. Left is what the model assumed; right is what some authorities publish. No figures: the figures live on each pack record.</span></div>
          <div className="tl-shapes">
            <div className="tl-shape">
              <div className="tl-shape__h"><span className="tl-shape__k">Itemised</span><span className="tl-tag tl-tag--n">shape</span><span className="tl-shape__p">each service separately measured</span></div>
              <div className="tl-shape__b">
                {ITEMISED.map(([l, r, subs]) => (
                  <div key={l}>
                    <div className="tl-row"><b>{l}</b><span>{r}</span></div>
                    <div className="tl-sub">{subs.map((x) => <div key={x}>{x}</div>)}</div>
                  </div>
                ))}
                <div className="tl-note">Six lines, six bases. The estimate is only as good as the count of tugs and the hours alongside, so each line names what it reads from the call.</div>
              </div>
            </div>
            <div className="tl-shape">
              <div className="tl-shape__h"><span className="tl-shape__k">Bundled</span><span className="tl-tag tl-tag--b">shape</span><span className="tl-shape__p">one figure on tonnage, hours on top</span></div>
              <div className="tl-shape__b">
                {BUNDLED.map(([l, r, subs]) => (
                  <div key={l} className={l === "Berth hire" ? "tl-row--zero" : undefined}>
                    <div className="tl-row"><b>{l}</b><span>{r}</span></div>
                    <div className="tl-sub">{subs.map((x) => <div key={x}>{x}</div>)}</div>
                  </div>
                ))}
                <div className="tl-note">Fewer priced lines, one of them most of the total. The exposure is not in the rate; it is in the hours beyond the allowance, which is why the settings page keeps the agreed stay and its trigger.</div>
              </div>
            </div>
          </div>
        </section>

        {SECTIONS.slice(0, 3).map((s) => (
          <section key={s.n} className="tl-sec" aria-labelledby={`tl-${s.n}`}>
            <div className="tl-sec__h"><span className="tl-sec__n">{s.n}</span><h2 id={`tl-${s.n}`} className="tl-sec__t">{s.title}</h2></div>
            <p className="tl-note"><span className="ap-none">{NR}.</span> {s.what}</p>
          </section>
        ))}

        <section className="tl-sec" aria-labelledby="tl-05">
          <div className="tl-sec__h"><span className="tl-sec__n">05</span><h2 id="tl-05" className="tl-sec__t">Which port uses which layout</h2><span className="tl-sec__x">Read from the packs published and in force today. The shape column stays empty until it is derived from the lines, never guessed.</span></div>
          {resolver.length === 0 ? <p className="tl-note"><span className="ap-none">{NR}.</span> No published tariff is in force on {on}.</p> : (
            <div className="tl-scrollx">
              <table className="tl-tbl">
                <caption className="asb-sr-only">Ports and the packs that price them</caption>
                <thead><tr><th scope="col">Port</th><th scope="col">Code</th><th scope="col">Priced by</th><th scope="col">Shape</th></tr></thead>
                <tbody>
                  {resolver.map((row) => (
                    <tr key={row.locode}>
                      <th scope="row">{row.name}</th>
                      <td>{row.locode}</td>
                      <td className={packCount(row) > 1 ? "tl-tag--w" : undefined}>
                        {row.packs.map((p, i) => <span key={`${p.packRef}-${p.terminal ?? ""}`}>{i ? " · " : ""}<Link href={`/dashboard/ports-da/tariff-packs/${p.packRef}?on=${on}`}>{p.authority}</Link>{p.terminal ? ` (${p.terminal})` : ""}</span>)}
                      </td>
                      <td><span className="ap-none">not derived yet</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {SECTIONS.slice(3).map((s) => (
          <section key={s.n} className="tl-sec" aria-labelledby={`tl-${s.n}`}>
            <div className="tl-sec__h"><span className="tl-sec__n">{s.n}</span><h2 id={`tl-${s.n}`} className="tl-sec__t">{s.title}</h2></div>
            <p className="tl-note"><span className="ap-none">{NR}.</span> {s.what}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

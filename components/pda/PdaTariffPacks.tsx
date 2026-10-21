// The design's Tariff Packs library (owner B2ALL-061, build step 6). A tariff belongs to the authority that issued it,
// not to a country: one card per published document, the ports it prices, then the port → packs resolver. Everything
// comes from list_pda_tariff_packs through the member's own session; verification and findings are not recorded yet,
// so those fields say so instead of showing a figure.
import Link from "next/link";
import { ArrowLeft, ChevronRight, FileText, ShieldCheck } from "lucide-react";

import { isPrimaryTariffPack, packCount, resolvePdaTariffPorts, summarisePdaTariffPacks, type PdaTariffPack } from "@/lib/pda/tariff-packs";

import "./pda-route-estimator.css";
import "./ports-module.css";

const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const packHref = (ref: string, on: string) => `/dashboard/ports-da/tariff-packs/${ref}?on=${on}`;

export function PdaTariffPacks({ packs, on, error }: { packs: PdaTariffPack[]; on: string; error?: string }) {
  const summary = summarisePdaTariffPacks(packs);
  const resolver = resolvePdaTariffPorts(packs);
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href="/dashboard/ports-da"><ArrowLeft size={15} aria-hidden="true" /> Ports Module</Link>
        <div className="pd-crumbs">Ports Module · <b>Tariff Packs</b></div>
      </div>

      <div className="pd-band pd-band--navy">
        <div className="pd-band__ey">Ports Module · tariff library</div>
        <h1 className="pd-band__title">Tariff Packs</h1>
        <p className="pd-band__sub">One pack per published tariff, held under the authority that issued it. Open a pack to read its record.</p>
        <div className="pd-band__badges">
          <span className="pd-badge"><span className="dot" aria-hidden="true"></span>{summary.packs} pack{summary.packs === 1 ? "" : "s"}</span>
          <span className="pd-badge"><FileText size={13} aria-hidden="true" /> {summary.portsResolved} port{summary.portsResolved === 1 ? "" : "s"} resolved</span>
          {summary.portsWithSeveral ? <span className="pd-badge"><ShieldCheck size={13} aria-hidden="true" /> {summary.portsWithSeveral} port{summary.portsWithSeveral === 1 ? "" : "s"} priced by more than one pack</span> : null}
        </div>
      </div>

      <div className="tp-wrap">
        <p className="tp-lede">
          A tariff belongs to the authority that issued it, not to a country. Ports in the same country publish their own,
          on different shapes and with different effective dates, so a single national card would have to average documents
          that do not agree. <b>The unit here is the published pack.</b> A port then resolves to the packs that price it, which is
          the lookup a broker actually starts from. Packs shown are those cited by a tariff in force on {day(on)}.
        </p>

        {error ? <p className="tp-note" role="alert">{error}</p> : null}

        <h2 className="tp-h">Packs <span>official documents first</span></h2>
        {packs.length === 0 && !error ? (
          <p className="tp-note">No published tariff is in force on this date, so there is no pack to show yet.</p>
        ) : (
          <ul className="tp-grid" aria-label="Tariff packs">
            {packs.map((pack) => <PackCard key={pack.packRef} pack={pack} on={on} />)}
          </ul>
        )}

        <h2 className="tp-h">Port to packs <span>the resolver: pick a port, get every pack that prices it</span></h2>
        {resolver.length ? (
          <div className="px-scrollx">
            <table className="tp-tbl">
              <caption className="asb-sr-only">Each port and the tariff packs that price it</caption>
              <thead><tr><th scope="col">Port</th><th scope="col">Code</th><th scope="col">Priced by</th><th scope="col">Shapes in play</th></tr></thead>
              <tbody>
                {resolver.map((row) => (
                  <tr key={row.locode}>
                    <th scope="row" className="k">{row.name}</th>
                    <td>{row.locode}</td>
                    <td className={packCount(row) > 1 ? "many" : undefined}>
                      {row.packs.map((p, i) => (
                        <span key={`${p.packRef}-${p.terminal ?? ""}`}>
                          {i ? " · " : ""}<Link href={packHref(p.packRef, on)}>{p.authority}</Link>{p.terminal ? ` (${p.terminal})` : ""}
                        </span>
                      ))}
                    </td>
                    <td className="is-empty" title="The layout shape is not derived yet">Not recorded yet</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tp-note">No port resolves to a pack on this date.</p>
        )}
        <p className="tp-note">
          Where a port shows more than one pack, the estimator has to be told which one governs the call, because the terminal
          decides. The layout shape (bundled or itemised) is not derived from the packs yet, and no charge line has been verified
          by a named person yet, so those fields say so rather than show a figure.
        </p>
      </div>
    </div>
  );
}

function PackCard({ pack, on }: { pack: PdaTariffPack; on: string }) {
  const effective = day(pack.effectiveFrom);
  const portNames = [...new Map(pack.ports.map((p) => [p.locode, p.name])).values()];
  const scope = portNames.length === 1 ? "single port" : "multi port";
  return (
    <li className="tp-card">
      <Link className="tp-card__link" href={packHref(pack.packRef, on)} aria-label={`Open the pack record: ${pack.authority}, ${pack.sourceTitle}`}>
        <div className="tp-card__hd">
          <div className="tp-card__who">
            <div className="tp-card__a">{pack.authority}</div>
            <div className="tp-card__p">{pack.sourceTitle || pack.country || "—"} · {scope}</div>
          </div>
          <ChevronRight size={18} aria-hidden="true" className="tp-card__caret" />
        </div>

        <div className="tp-chips">
          <span className="tp-chip" title="The layout shape is not derived yet">Shape not recorded</span>
          {pack.currency ? <span className="tp-chip">{pack.currency === "mixed" ? "Mixed currencies" : pack.currency}</span> : null}
          {isPrimaryTariffPack(pack) ? <span className="tp-chip is-b">Primary source</span> : <span className="tp-chip is-w">Secondary</span>}
        </div>

        <dl className="tp-kv">
          <div><dt className="k">Effective</dt><dd className={`v${effective ? "" : " is-empty"}`}>{effective ?? "not stated"}</dd></div>
          <div><dt className="k">Charge lines</dt><dd className="v">{pack.lines}</dd></div>
          <div><dt className="k">Verified</dt><dd className="v is-empty">0 of {pack.lines}</dd></div>
          <div><dt className="k">Open findings</dt><dd className="v is-empty">none recorded</dd></div>
        </dl>

        <div className="tp-ports">
          {portNames.slice(0, 5).map((name) => <span key={name} className="tp-chip">{name}</span>)}
          {portNames.length > 5 ? <span className="tp-chip">plus {portNames.length - 5}</span> : null}
        </div>

        <div className="tp-foot"><FileText size={13} aria-hidden="true" /> Open the pack record</div>
      </Link>
    </li>
  );
}

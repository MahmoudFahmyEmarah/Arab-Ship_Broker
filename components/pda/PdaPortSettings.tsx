// The design's Port Settings (owner B2ALL-061, build step 9): one page per port, arms across the top, every slot named
// by the model and rendered from it. Read-only, published view: a slot fills only when the port's tariffs or the agency
// registry answer it; the rest says "Not recorded yet" and keeps the design's explanation of what it is for.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import type { PdaPortRecordInput } from "@/lib/pda/port-record";
import { PDA_SETTING_ARMS, settingValue, tariffArmPacks, tariffArmRows, type PdaSettingArmId } from "@/lib/pda/port-settings";

import "./pda-route-estimator.css";
import "./ports-module.css";

export function PdaPortSettings({ input, arm }: { input: PdaPortRecordInput; arm: PdaSettingArmId }) {
  const { port, on } = input;
  const base = `/dashboard/ports-da/ports/${port.locode}`;
  const current = PDA_SETTING_ARMS.find((a) => a.id === arm) ?? PDA_SETTING_ARMS[0]!;
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href={`${base}?on=${on}`}><ArrowLeft size={15} aria-hidden="true" /> Port record</Link>
        <div className="pd-crumbs">Ports Module · Ports · <b>{port.name}</b> · Port settings</div>
        <div className="pd-topbar__end"><span className="pdr-role">Published record</span></div>
      </div>

      <div className="ps-main">
        <div className="ps-top">
          <div>
            <h1 className="ps-top__n">{port.name} — port settings</h1>
            <div className="ps-top__s">{port.locode}{port.country ? ` · ${port.country}` : ""} · the background behind the estimate</div>
          </div>
          <div className="ps-top__a">
            <Link className="asb-btn" href={`${base}?on=${on}`}>Port record</Link>
            <Link className="asb-btn asb-btn--primary" href="/dashboard/ports-da">Back to the estimate</Link>
          </div>
        </div>

        <nav className="ps-arms" aria-label="Settings arms">
          {PDA_SETTING_ARMS.map((a) => (
            <Link key={a.id} className={`ps-arms__b${a.id === current.id ? " is-on" : ""}`} href={`${base}/settings?on=${on}&arm=${a.id}`} aria-current={a.id === current.id ? "page" : undefined}>
              {a.label}
            </Link>
          ))}
        </nav>

        <div className="ps-body">
          <p className="ps-hint">{current.hint}</p>

          {current.id === "tariff" ? (
            <TariffArm input={input} />
          ) : current.sections.map((sec) => (
            <section key={sec.id} className="ps-card" aria-labelledby={`ps-${sec.id}`}>
              <div className="ps-card__hd"><h2 id={`ps-${sec.id}`} className="ps-card__t">{sec.label}</h2><span className="ps-card__h">Published values</span></div>
              {sec.slots.map((slot) => {
                const v = settingValue(slot, input);
                return (
                  <div key={slot.path} className="ps-slot">
                    <div className="ps-slot__k">
                      <div className="ps-slot__l">{slot.label}</div>
                      {slot.help ? <div className="ps-slot__h">{slot.help}</div> : null}
                    </div>
                    <div className="ps-slot__v">
                      {v.value ? <span className="ps-val">{v.value}{slot.unit ? <span className="ps-unit"> {slot.unit}</span> : null}</span> : <span className="ps-val ps-val--none">Not recorded yet</span>}
                      {v.source ? <span className="asb-badge asb-badge--neutral">{v.source === "registry" ? "Agency registry" : "Tariff"}</span> : null}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}

          <p className="ps-basis__n">
            Nothing on this page is typed in by hand yet. A slot fills when the port&apos;s tariffs or the agency registry answer it;
            third-party contributions will queue here once the settings store ships. The estimator meanwhile uses what you enter
            on the Estimate tab and says so on every figure.
          </p>
        </div>
      </div>
    </div>
  );
}

function TariffArm({ input }: { input: PdaPortRecordInput }) {
  const { port, packs, on } = input;
  const here = tariffArmPacks(port, packs);
  if (!here.length) {
    return (
      <div className="ps-card">
        <div className="ps-slot">
          <div className="ps-slot__k"><div className="ps-slot__l">No tariff pack resolves for {port.name}</div><div className="ps-slot__h">No published tariff is in force at this port on {on}; every service needs a manual quote in the estimate.</div></div>
          <div className="ps-slot__v"><span className="ps-val ps-val--none">Not recorded yet</span></div>
        </div>
      </div>
    );
  }
  return (
    <div className="ps-card">
      <div className="ps-card__hd"><h2 className="ps-card__t">The tariffs that price this port</h2><span className="ps-card__h">Each held on its own record</span></div>
      {tariffArmRows(port, packs).map(([k, v]) => (
        <div key={k} className="ps-slot">
          <div className="ps-slot__k"><div className="ps-slot__l">{k}</div></div>
          <div className="ps-slot__v">{v ? <span className="ps-val">{v}</span> : <span className="ps-val ps-val--none">Not recorded yet</span>}</div>
        </div>
      ))}
      {here.map((k) => (
        <div key={k.packRef} className="ps-slot">
          <div className="ps-slot__k"><div className="ps-slot__l">{k.authority}</div><div className="ps-slot__h">{k.detail}</div></div>
          <div className="ps-slot__v"><Link className="asb-btn" href={`/dashboard/ports-da/tariff-packs/${k.packRef}?on=${on}`}>Open the pack record</Link></div>
        </div>
      ))}
    </div>
  );
}

"use client";

// Post Vessel — Ownership & management strip (Q88 five-tier chain) with the
// split-screen company picker. Ported from reference/handoff/asb/pp2-steps.jsx;
// the demo company list is replaced by the real registry (search_companies)
// and the profile detail is tier-gated SERVER-SIDE via get_company_profile
// (the client only renders what the RPC returns).

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useViewerTier } from "@/lib/portal/tier";
import { getCompanyProfile, searchCompanies, type CompanyHit, type CompanyProfile } from "@/sdk/app/ledger";
import type { LedgerVessel } from "./state";

const TIERS: { key: keyof LedgerVessel; label: string }[] = [
  { key: "regOwner", label: "Registered owner" },
  { key: "parentGroup", label: "Parent group" },
  { key: "ismManager", label: "Technical operator" },
  { key: "manager", label: "Commercial operator / Manager" },
  { key: "disponentOwner", label: "Disponent owner" },
];

function CompanyDetail({ c }: { c: CompanyProfile }) {
  return (
    <div className="pp2-co">
      <div className="pp2-co__name">{c.name}</div>
      <div className="pp2-co__meta">{[c.country, c.imo ? "Co. IMO " + c.imo : null].filter(Boolean).join(" · ") || "Company"}</div>
      <div className="pp2-co__roles">
        <span className="pp2-co__role">Owns {c.owns_count ?? 0}</span>
        <span className="pp2-co__role">Manages {c.manages_comm_count ?? 0}</span>
        <span className="pp2-co__role">ISM {c.ism_manages_count ?? 0}</span>
        <span className="pp2-co__role">Fleet {c.fleet_total ?? 0}</span>
      </div>
      {c.address ? (
        <div className="pp2-co__row">
          <span>Address</span>
          <span>{c.address}</span>
        </div>
      ) : null}
      {c.desk_contact_name ? (
        <div className="pp2-co__row">
          <span>Contacts</span>
          <span>{c.desk_contact_name}</span>
        </div>
      ) : null}
      {c.desk_phone ? (
        <div className="pp2-co__row">
          <span>Phone</span>
          <span>{c.desk_phone}</span>
        </div>
      ) : null}
      {c.desk_email ? (
        <div className="pp2-co__row">
          <span>Email</span>
          <span>{c.desk_email}</span>
        </div>
      ) : null}
      {c.link_note ? <div className="pp2-co__note">{c.link_note}</div> : null}
    </div>
  );
}

function LockedDetail({ name, country }: { name: string; country?: string | null }) {
  return (
    <div className="pp2-co pp2-co--locked">
      <div className="pp2-co__name">{name}</div>
      <div className="pp2-co__meta">{country || "Company"}</div>
      <div className="pp2-lock">
        <div className="pp2-lock__t">Company profiles are a Tier 3 feature</div>
        <div className="pp2-lock__s">Address, contacts, phone and email unlock for Tier 3 and Tier 4 subscribers.</div>
      </div>
    </div>
  );
}

export function OwnershipBlock({ v, patch }: { v: LedgerVessel; patch?: (u: Partial<LedgerVessel>) => void }) {
  const tier = useViewerTier();
  const canView = tier === "T3" || tier === "T4";
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<keyof LedgerVessel | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CompanyHit[]>([]);
  const [sel, setSel] = useState<CompanyHit | null>(null);
  const [profileState, setProfileState] = useState<{ id: string; profile: CompanyProfile } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keyed by company id so a stale profile is never shown while loading.
  const profile = sel && profileState?.id === sel.id ? profileState.profile : null;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        const supabase = getSupabaseBrowserClient();
        setResults(await searchCompanies(supabase, q, 40));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  // Server-gated profile fetch for the selected company.
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const p = await getCompanyProfile(supabase, sel.id);
        if (alive) setProfileState({ id: sel.id, profile: p });
      } catch {
        /* teaser stays visible on transient errors */
      }
    })();
    return () => {
      alive = false;
    };
  }, [sel]);

  const tierLabel = (k: keyof LedgerVessel | null) => TIERS.find((t) => t.key === k)?.label ?? "";
  const openSearch = (k: keyof LedgerVessel) => {
    setTarget(k);
    setSel(null);
    setQ("");
    setOpen(true);
  };
  const assign = (co: CompanyHit) => {
    if (patch && target) patch({ [target]: co.name } as Partial<LedgerVessel>);
    setOpen(false);
    setTarget(null);
  };

  const owner = v.regOwner || null;
  const mgr = v.manager || null;
  const summary = [owner ? "Owner " + owner : null, mgr ? "Mgr " + mgr : null].filter(Boolean).join(" · ") || "Not on file";

  return (
    <div className="pp2-own">
      <button type="button" className="pp2-own__bar" onClick={() => setExpanded((x) => !x)}>
        <span className="pp2-own__title">Ownership &amp; management</span>
        <span className="pp2-own__sum">{summary}</span>
        <span className="pp2-own__car">{expanded ? "Hide" : "Manage"}</span>
      </button>
      {expanded && !open && (
        <div className="pp2-own__body">
          <div className="pp2-own__tierhdr">
            <span>Q88 chain</span>
          </div>
          {TIERS.map((tr) => {
            const val = v[tr.key] as string | null | undefined;
            return (
              <div className="pp2-own__tier" key={tr.key as string}>
                <span className="pp2-own__k">{tr.label}</span>
                <span className={"pp2-own__v" + (val ? "" : " is-empty")}>{val || "Not on file"}</span>
                {val ? (
                  canView ? (
                    <button
                      type="button"
                      className="pp2-own__act"
                      onClick={() => {
                        setTarget(null);
                        setQ(val);
                        setOpen(true);
                      }}
                    >
                      View
                    </button>
                  ) : (
                    <span className="pp2-own__lock">Tier 3+</span>
                  )
                ) : null}
                {patch ? (
                  <button type="button" className="pp2-own__act pp2-own__act--ghost" onClick={() => openSearch(tr.key)}>
                    {val ? "Change" : "Add"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {expanded && open && (
        <div className="pp2-split2">
          <div className="pp2-split2__hd">
            <span className="pp2-split2__ttl">{target ? "Assign: " + tierLabel(target) : "Company profile"}</span>
            <button
              type="button"
              className="pp2-split2__x"
              onClick={() => {
                setOpen(false);
                setTarget(null);
              }}
            >
              Close
            </button>
          </div>
          <div className="pp2-split2__bd">
            <div className="pp2-split2__left">
              <input
                className="pp2-select pp2-split2__search"
                style={{ backgroundImage: "none" }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search companies…"
              />
              <div className="pp2-split2__list">
                {results.map((c) => (
                  <button type="button" key={c.id} className={"pp2-split2__item" + (sel?.id === c.id ? " is-sel" : "")} onClick={() => setSel(c)}>
                    <span className="pp2-split2__cn">{c.name}</span>
                    <span className="pp2-split2__cm">{[c.country, c.fleet_total != null ? "fleet " + c.fleet_total : null].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
                {!results.length ? <div className="pp2-split2__empty">{q.trim().length >= 2 ? "No match." : "Type at least 2 letters."}</div> : null}
              </div>
            </div>
            <div className="pp2-split2__right">
              {!sel ? (
                <div className="pp2-split2__empty">Select a company to view its profile.</div>
              ) : profile && !profile.gated ? (
                <CompanyDetail c={profile} />
              ) : (
                <LockedDetail name={sel.name} country={sel.country} />
              )}
              {sel && target && patch ? (
                <button type="button" className="pp2-own__assign" onClick={() => assign(sel)}>
                  Assign to {tierLabel(target)}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

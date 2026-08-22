"use client";

// Settings → WhatsApp connection. Two providers behind one pipeline:
//   • meta       — official Cloud API (webhook push; token/app-secret/verify in Vault)
//   • unofficial — QR-link a normal number via the companion worker (testing)
// The QR pairing pane polls whatsapp_runtime, which the worker keeps updated.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Loader2, Check, MessageCircle, AlertTriangle, Play, Square } from "lucide-react";
import {
  getWhatsappConfig, saveWhatsappConfig, getWhatsappRuntime,
  startWhatsappWorker, stopWhatsappWorker,
  type WhatsappConfigMeta, type WhatsappRuntimeView,
} from "@/app/(admin)/admin/data-sync/settings-actions";
import { C, btn } from "./ui";

const field: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13.5, color: C.ink, background: "#fff" };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 5, display: "block" };

export function WhatsappSettingsCard() {
  const [cfg, setCfg] = useState<WhatsappConfigMeta | null | undefined>(undefined);
  const [provider, setProvider] = useState<"meta" | "unofficial">("unofficial");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [autoReply, setAutoReply] = useState(true);
  const [replyTemplate, setReplyTemplate] = useState("");
  const [platformUrl, setPlatformUrl] = useState("https://arabshipbroker.com");
  const [saving, setSaving] = useState(false);
  const [runtime, setRuntime] = useState<WhatsappRuntimeView | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let c = false;
    (async () => {
      await Promise.resolve();
      if (typeof window !== "undefined" && !c) setOrigin(window.location.origin);
      const r = await getWhatsappConfig();
      if (c) return;
      if (!r.success) { toast.error(r.error); setCfg(null); return; }
      setCfg(r.data);
      if (r.data) {
        setProvider(r.data.provider);
        setPhoneNumberId(r.data.phone_number_id ?? "");
        setBusinessId(r.data.business_id ?? "");
        setEnabled(r.data.is_enabled);
        setAutoReply(r.data.auto_reply);
        setReplyTemplate(r.data.reply_template);
        setPlatformUrl(r.data.platform_url);
      }
    })();
    return () => { c = true; };
  }, []);

  // poll runtime while the unofficial provider pane is visible
  const pollRuntime = useCallback(async () => {
    const r = await getWhatsappRuntime();
    if (r.success) setRuntime(r.data);
  }, []);
  useEffect(() => {
    if (provider !== "unofficial") return;
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) await pollRuntime(); })();
    const t = setInterval(pollRuntime, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [provider, pollRuntime]);

  // render QR whenever runtime carries one
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!runtime?.qr) { if (!cancelled) setQrUrl(null); return; }
      try {
        const url = await QRCode.toDataURL(runtime.qr, { margin: 1, width: 220 });
        if (!cancelled) setQrUrl(url);
      } catch { if (!cancelled) setQrUrl(null); }
    })();
    return () => { cancelled = true; };
  }, [runtime?.qr]);

  const [workerBusy, setWorkerBusy] = useState(false);
  const startWorker = async () => {
    setWorkerBusy(true);
    const r = await startWhatsappWorker();
    if (!r.success) { setWorkerBusy(false); toast.error(r.error); return; }
    toast.success("Worker starting — the pairing QR appears here in a few seconds.");
    // poll a little faster until it reports in
    setTimeout(pollRuntime, 2500);
    setTimeout(pollRuntime, 5000);
    setTimeout(() => setWorkerBusy(false), 5000);
  };
  const stopWorker = async () => {
    setWorkerBusy(true);
    const r = await stopWhatsappWorker();
    setWorkerBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Worker stopping…");
    setTimeout(pollRuntime, 4000);
  };

  const save = async () => {
    setSaving(true);
    const r = await saveWhatsappConfig({
      provider, phoneNumberId, businessId,
      token: token || null, appSecret: appSecret || null, verifyToken: verifyToken || null,
      enabled, autoReply, replyTemplate, platformUrl,
    });
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    setToken(""); setAppSecret(""); setVerifyToken("");
    toast.success("WhatsApp settings saved.");
  };

  if (cfg === undefined) {
    return <div style={{ padding: 30, textAlign: "center", color: C.ink3 }}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /></div>;
  }

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff", padding: 18 }}>
      {/* provider toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["unofficial", "meta"] as const).map((p) => {
          const on = provider === p;
          return (
            <button key={p} onClick={() => setProvider(p)}
              style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${on ? C.brass : C.line}`, background: on ? C.brassBg : "#fff", color: on ? C.brassDeep : C.ink2, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: on ? 600 : 500 }}>
              {p === "meta" ? "Meta Cloud API (official)" : "QR-linked number (testing)"}
            </button>
          );
        })}
      </div>

      {provider === "unofficial" ? (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 8, marginBottom: 14 }}>
            <AlertTriangle size={15} color={C.amber} style={{ flex: "none", marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: C.brassDeep, lineHeight: 1.5 }}>
              Linking a normal number automates a personal WhatsApp account, which WhatsApp&apos;s terms disallow — numbers can be banned. Use for testing; switch to Meta Cloud API for production.
            </span>
          </div>
          {/* pairing pane */}
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", padding: "14px 16px", background: C.sunken, borderRadius: 10, marginBottom: 6 }}>
            {runtime?.state === "connected" ? (
              <>
                <span style={{ width: 40, height: 40, borderRadius: 9, background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={20} /></span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>Connected</div>
                  <div style={{ fontSize: 12.5, color: C.ink3, fontFamily: C.mono }}>{runtime.linked_as ?? ""}</div>
                </div>
                <button onClick={stopWorker} disabled={workerBusy} style={{ ...btn("danger"), marginLeft: "auto" }}>
                  {workerBusy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Square size={13} />} Stop worker
                </button>
              </>
            ) : runtime?.state === "pairing" && qrUrl ? (
              <>
                {/* QR from the worker — data URL, no external fetch */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt="WhatsApp pairing QR" width={150} height={150} style={{ borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff" }} />
                <div style={{ maxWidth: 320 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.navy, marginBottom: 4 }}>Scan to link</div>
                  <div style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>
                    WhatsApp → Settings → Linked devices → <b>Link a device</b>, then scan this code.
                  </div>
                  <button onClick={stopWorker} disabled={workerBusy} style={{ ...btn("ghost"), marginTop: 10 }}>
                    <Square size={13} /> Stop worker
                  </button>
                </div>
              </>
            ) : runtime?.worker_alive || workerBusy ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.ink2 }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Worker starting — waiting for the pairing QR…
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.6, flex: 1, minWidth: 220 }}>
                  <b style={{ color: C.navy }}>Worker offline.</b> Start the connection worker to receive messages and get the pairing QR. It runs on the application server — no terminal needed.
                </div>
                <button onClick={startWorker} disabled={workerBusy} style={btn("dark")}>
                  {workerBusy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={14} />} Start worker
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 6 }}>
          <div><label style={lab}>Phone-number ID</label><input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="from Meta → WhatsApp → API setup" style={field} /></div>
          <div><label style={lab}>Business (WABA) ID <span style={{ color: C.ink3, fontWeight: 400 }}>(optional)</span></label><input value={businessId} onChange={(e) => setBusinessId(e.target.value)} style={field} /></div>
          <div><label style={lab}>Access token {cfg?.has_token && <span style={{ color: C.ink3, fontWeight: 400 }}>(stored — blank keeps it)</span>}</label><input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" style={field} /></div>
          <div><label style={lab}>App secret {cfg?.has_app_secret && <span style={{ color: C.ink3, fontWeight: 400 }}>(stored)</span>}</label><input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} autoComplete="off" style={field} /></div>
          <div><label style={lab}>Webhook verify token {cfg?.has_verify && <span style={{ color: C.ink3, fontWeight: 400 }}>(stored)</span>}</label><input type="password" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} autoComplete="off" style={field} /></div>
          <div>
            <label style={lab}>Webhook URL (paste in Meta console)</label>
            <div style={{ ...field, background: C.sunken, fontFamily: C.mono, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {origin || "https://<your-domain>"}/api/whatsapp/webhook
            </div>
          </div>
        </div>
      )}

      {/* shared: reply behaviour */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div>
            <label style={lab}>Platform URL (in replies)</label>
            <input value={platformUrl} onChange={(e) => setPlatformUrl(e.target.value)} style={field} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 22, paddingBottom: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink2, cursor: "pointer" }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink2, cursor: "pointer" }}>
              <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} /> Auto-reply on parse
            </label>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={lab}>Auto-reply template <span style={{ color: C.ink3, fontWeight: 400 }}>placeholders: {"{{name}} {{summary}} {{url}}"}</span></label>
          <textarea value={replyTemplate} onChange={(e) => setReplyTemplate(e.target.value)} rows={5} style={{ ...field, resize: "vertical", fontFamily: C.mono, fontSize: 12.5 }} />
        </div>
        <div style={{ display: "flex", marginTop: 14 }}>
          <button onClick={save} disabled={saving} style={{ ...btn("primary"), marginLeft: "auto" }}>
            {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} Save WhatsApp settings
          </button>
        </div>
        <p style={{ fontSize: 12, color: C.ink3, marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
          <MessageCircle size={12} style={{ verticalAlign: "-2px" }} /> Replies never include commission, freight ideas, rates, broker names or notes — only the operational shape of the enquiry.
        </p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

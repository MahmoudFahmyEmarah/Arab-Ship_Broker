import Link from "next/link";

export const metadata = { title: "Cookie Policy — Arab ShipBroker" };

const ROWS = [
  ["sb-…-auth-token", "Cookie", "Strictly necessary", "Keeps you signed in (Supabase session). Set at login; removed at sign-out."],
  ["asb_cookie_consent", "Cookie", "Strictly necessary", "Remembers your cookie choice for 1 year."],
  ["asb:prefs / asb:notifs", "Local storage", "Preferences", "Display preferences and notification toggles (Settings)."],
  ["asb:mapBase", "Local storage", "Preferences", "Day / night map style."],
  ["asb:bosunPos", "Local storage", "Preferences", "Assistant window position."],
];

export default function CookiePolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-ocean-900">Cookie Policy</h1>
      <p className="text-sm text-slate-600 mt-3 leading-relaxed">
        Arab ShipBroker uses a small number of first-party cookies and local
        storage. We run <strong>no advertising and no analytics trackers</strong>,
        and we never share data with ad networks. Strictly necessary items keep
        the platform working (your sign-in session and this consent choice);
        preference items are stored only with your consent and can be declined
        or revoked at any time.
      </p>
      <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Purpose</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ROWS.map(([n, t, c, p]) => (
              <tr key={n}>
                <td className="px-4 py-3 font-mono text-xs text-ocean-900 whitespace-nowrap">{n}</td>
                <td className="px-4 py-3 text-slate-600">{t}</td>
                <td className="px-4 py-3 text-slate-600">{c}</td>
                <td className="px-4 py-3 text-slate-600">{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600 mt-6">
        Change your choice anytime via <strong>Cookie settings</strong> in the
        footer, or in the portal under Settings → Security &amp; Privacy. See also
        our <Link className="text-ocean-600 underline" href="/legal">Privacy &amp; Legal</Link> page.
      </p>
    </div>
  );
}

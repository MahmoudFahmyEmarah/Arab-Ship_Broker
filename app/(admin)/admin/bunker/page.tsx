import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { addSupplier, addPrice, setCredential, toggleSupplier } from "./actions";

type Supplier = { id: string; name: string; slug: string; port: string | null; website: string | null; is_active: boolean };
type Account = { supplier_id: string; username: string; last_seen_at: string | null; is_active: boolean };
type Price = { supplier_id: string; fuel: string; value: number; dir: string | null; observed_at: string };

export default async function AdminBunkerPage() {
  await requireAdmin();
  const supabase = await getSupabaseServerClient();

  const [{ data: sup }, { data: acc }, { data: pr }] = await Promise.all([
    supabase.from("bunker_suppliers").select("id,name,slug,port,website,is_active").order("name"),
    supabase.from("bunker_ingest_accounts").select("supplier_id,username,last_seen_at,is_active"),
    supabase.from("bunker_prices").select("supplier_id,fuel,value,dir,observed_at").order("observed_at", { ascending: false }).limit(200),
  ]);
  const suppliers = (sup ?? []) as Supplier[];
  const accounts = (acc ?? []) as Account[];
  const prices = (pr ?? []) as Price[];
  const latestFor = (id: string) => prices.filter((p) => p.supplier_id === id).slice(0, 6);
  const acctFor = (id: string) => accounts.find((a) => a.supplier_id === id) ?? null;

  const field = "h-9 px-3 rounded border border-asb-gray-200 bg-white text-sm focus:outline-none focus:border-asb-blue";

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Bunker prices"
        subtitle="Manage suppliers, prices and the credentialed ingest channel (suppliers POST daily/weekly prices to /api/bunker/ingest)."
      />

      {/* Add supplier */}
      <form action={addSupplier} className="bg-white border border-asb-gray-200 rounded p-5 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Supplier name *</label><input name="name" required className={field} /></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Port(s)</label><input name="port" placeholder="Fujairah" className={field} /></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Website</label><input name="website" placeholder="https://…" className={field} /></div>
        <button className="h-9 px-4 rounded bg-asb-blue text-white text-sm font-semibold">Add supplier</button>
      </form>

      {suppliers.length === 0 && (
        <p className="text-sm text-asb-gray-500">No suppliers yet. Add one above. (If this is empty after applying migrations, the table may be unseeded — the public ticker falls back to demo data.)</p>
      )}

      {suppliers.map((s) => {
        const a = acctFor(s.id);
        return (
          <div key={s.id} className="bg-white border border-asb-gray-200 rounded p-5 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="font-bold text-asb-navy">{s.name}</h3>
                <p className="text-xs text-asb-gray-500">{s.port ?? "—"} · {s.website ?? "no site"} · {s.is_active ? "active" : "inactive"}</p>
              </div>
              <form action={toggleSupplier}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="active" value={String(s.is_active)} />
                <button className="text-xs font-semibold px-3 py-1.5 rounded border border-asb-gray-200 hover:border-asb-blue">
                  {s.is_active ? "Deactivate" : "Activate"}
                </button>
              </form>
            </div>

            {/* Latest prices */}
            <div className="flex flex-wrap gap-2">
              {latestFor(s.id).length === 0 && <span className="text-xs text-asb-gray-400">No prices yet</span>}
              {latestFor(s.id).map((p, i) => (
                <span key={i} className="text-xs bg-asb-gray-50 border border-asb-gray-200 rounded px-2 py-1">
                  <b>{p.fuel}</b> ${Number(p.value).toLocaleString()} {p.dir ?? ""} · {new Date(p.observed_at).toLocaleDateString("en-GB")}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-4">
              {/* Add price */}
              <form action={addPrice} className="flex flex-wrap items-end gap-2 border-t border-asb-gray-100 pt-4">
                <input type="hidden" name="supplier_id" value={s.id} />
                <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Fuel</label>
                  <select name="fuel" className={field}><option>VLSFO</option><option>LSMGO</option><option>MGO</option><option>IFO 380</option></select></div>
                <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Value (USD/MT)</label><input name="value" type="number" step="0.01" required className={`${field} w-32`} /></div>
                <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Dir</label>
                  <select name="dir" className={field}><option value="">—</option><option value="up">up ▲</option><option value="down">down ▼</option><option value="flat">flat</option></select></div>
                <button className="h-9 px-4 rounded bg-asb-navy text-white text-sm font-semibold">Add price</button>
              </form>

              {/* Provision / reset ingest credential */}
              <form action={setCredential} className="flex flex-wrap items-end gap-2 border-t border-asb-gray-100 pt-4">
                <input type="hidden" name="supplier_id" value={s.id} />
                <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Ingest username</label>
                  <input name="username" defaultValue={a?.username ?? `${s.slug}-feed`} className={field} /></div>
                <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-asb-gray-500">Password (set/reset)</label>
                  <input name="secret" type="text" placeholder="generate a strong one" className={field} /></div>
                <button className="h-9 px-4 rounded border border-asb-blue text-asb-blue text-sm font-semibold">{a ? "Reset credential" : "Provision credential"}</button>
                {a && <span className="text-xs text-asb-gray-400 w-full">Account: <b>{a.username}</b> · last seen {a.last_seen_at ? new Date(a.last_seen_at).toLocaleString("en-GB") : "never"}</span>}
              </form>
            </div>
          </div>
        );
      })}

      <div className="bg-asb-blue-light border border-asb-gray-200 rounded p-4 text-xs text-asb-gray-600">
        <p className="font-bold mb-1">Supplier ingest channel</p>
        <p>Suppliers POST to <code>/api/bunker/ingest</code> with HTTP Basic auth (their username/password) and a JSON body:</p>
        <pre className="mt-2 bg-white border border-asb-gray-200 rounded p-2 overflow-auto">{`{ "prices": [ { "fuel":"VLSFO","value":1183,"dir":"down" }, { "fuel":"LSMGO","value":1118,"dir":"down" } ] }`}</pre>
        <p className="mt-2">Auth + insert run inside the <code>bunker_ingest()</code> DB function — no service-role key is exposed. Prices flow straight into the public ticker (active suppliers, ≤21 days old).</p>
      </div>
    </div>
  );
}

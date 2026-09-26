import {
  buildPdaEstimatorCatalog,
  markPdaEstimatorCatalogUnavailable,
  resolvePdaEstimatorBootstrap,
  type PdaEstimatorBootstrap,
  type PdaEstimatorPortOption,
  type PdaEstimatorSearchParams,
} from "@/lib/pda/estimator-contract";
import { loadCargoViews, loadVesselViews } from "@/lib/portal/data";
import type { PdaCoverageItem, PdaTerminalItem } from "@/sdk/app/pda";
import { listPdaCoverage, listPdaTerminals } from "@/sdk/app/pda";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PdaEstimatorPageData {
  bootstrap: PdaEstimatorBootstrap;
  coverage: PdaCoverageItem[];
  terminals: PdaTerminalItem[];
}

export async function loadPdaEstimatorPageData(
  supabase: SupabaseClient,
  params: PdaEstimatorSearchParams,
  callDate: string,
): Promise<PdaEstimatorPageData> {
  const [vessels, cargos, coverage, terminals, portsResult] = await Promise.all([
    loadVesselViews({ mine: true }),
    loadCargoViews({ mine: true }),
    listPdaCoverage(supabase, callDate),
    listPdaTerminals(supabase),
    supabase
      .from("ports")
      .select("locode, trade_name, country")
      .eq("is_active", true)
      .eq("is_verified", true)
      .order("trade_name")
      .limit(1000),
  ]);

  if (portsResult.error) throw new Error(portsResult.error.message);
  const ports = (portsResult.data ?? []).map((port) => ({
    locode: port.locode,
    name: port.trade_name,
    country: port.country,
  })) satisfies PdaEstimatorPortOption[];

  const catalog = buildPdaEstimatorCatalog({
    vessels: vessels.source === "live" ? vessels.views : [],
    cargos: cargos.source === "live" ? cargos.views : [],
    ports,
  });
  const resolved = resolvePdaEstimatorBootstrap(catalog, params);
  const bootstrap = vessels.source === "live" && cargos.source === "live"
    ? resolved
    : markPdaEstimatorCatalogUnavailable(resolved);

  return { bootstrap, coverage, terminals };
}

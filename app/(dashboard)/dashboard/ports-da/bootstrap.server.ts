import {
  buildPdaEstimatorCatalog,
  markPdaEstimatorCatalogUnavailable,
  resolvePdaEstimatorBootstrap,
  type PdaEstimatorBootstrap,
  type PdaEstimatorPortOption,
  type PdaEstimatorSearchParams,
} from "@/lib/pda/estimator-contract";
import { loadCargoViews, loadVesselViews } from "@/lib/portal/data";
import type { PdaTerminalItem } from "@/sdk/app/pda";
import { getMyPdaPreferences, listPdaTerminals } from "@/sdk/app/pda";
import { PDA_PREFERENCE_DEFAULTS, type PdaPreferences } from "@/lib/pda/preferences";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PdaEstimatorPageData {
  bootstrap: PdaEstimatorBootstrap;
  terminals: PdaTerminalItem[];
  /** the member's Setup preferences; the defaults when none are saved or they cannot be read */
  preferences: PdaPreferences;
}

export async function loadPdaEstimatorPageData(
  supabase: SupabaseClient,
  params: PdaEstimatorSearchParams,
  _callDate: string,
): Promise<PdaEstimatorPageData> {
  // (C2O-120) the unused tariff-coverage list is no longer fetched or serialised to the member's browser
  const [vessels, cargos, terminals, portsResult, preferences] = await Promise.all([
    loadVesselViews({ mine: true }),
    loadCargoViews({ mine: true }),
    listPdaTerminals(supabase),
    supabase
      .from("ports")
      .select("locode, trade_name, country")
      .eq("is_active", true)
      .eq("is_verified", true)
      .order("trade_name")
      .limit(1000),
    // a preference only changes how the page is shown: if it cannot be read, the page opens with the defaults
    getMyPdaPreferences(supabase).catch(() => PDA_PREFERENCE_DEFAULTS),
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

  return { bootstrap, terminals, preferences };
}

// Static fallback port coordinates keyed by UN/LOCODE → [lat, lon]. Live
// coordinates come from the `ports` table (latitude/longitude) via loadPortCoords;
// this keeps maps populated in the preview when the DB isn't reachable. Plain
// module (no Leaflet) so it's safe to import from server components too.
export const FALLBACK_PORTS: Record<string, [number, number]> = {
  ROCND: [44.18, 28.66], // Constanta
  TRIST: [41.01, 28.98], // Istanbul
  RUNVS: [44.72, 37.78], // Novorossiysk
  UAODS: [46.48, 30.74], // Odessa
  TRIZM: [38.42, 27.14], // Izmir
  GRPIR: [37.94, 23.65], // Piraeus
  TRMER: [36.81, 34.63], // Mersin
  TRISK: [36.61, 36.18], // Iskenderun
  LBBEY: [33.89, 35.5], // Beirut
  EGALY: [31.2, 29.92], // Alexandria
  EGDAM: [31.42, 31.81], // Damietta
  EGPSD: [31.27, 32.3], // Port Said
  JOAQJ: [29.53, 34.99], // Aqaba
  SAYNB: [24.09, 38.06], // Yanbu
  SAJED: [21.49, 39.18], // Jeddah
  AEJEA: [25.01, 55.04], // Jebel Ali
  OMSOH: [24.36, 56.71], // Sohar
  AEFJR: [25.13, 56.34], // Fujairah
  INMUM: [19.07, 72.85], // Mumbai
  TZDAR: [-6.8, 39.3], // Dar es Salaam
};

export function resolveCoord(
  locode: string | null | undefined,
  portCoords?: Record<string, [number, number]>,
): [number, number] | null {
  if (!locode) return null;
  return portCoords?.[locode] ?? FALLBACK_PORTS[locode] ?? null;
}

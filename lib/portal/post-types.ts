// Shared option types for the Post flows (importable by client + server).
export type CargoOpt = { id: string; name: string; cargoType: string; isDg: boolean; isGrain: boolean };
export type VesselOpt = { id: string; name: string; imo: string };

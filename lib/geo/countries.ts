// Flag-state names for the vessel-registration picker. The registry itself
// (canonical names, aliases, open/national category) lives in
// lib/geo/flag-states.ts and is mirrored by the flag_states DB table — this
// re-export keeps older imports working. Maritime-first ordering.
import { FLAG_STATE_NAMES } from "./flag-states";

export const FLAG_STATES: readonly string[] = FLAG_STATE_NAMES;

// The 12 International Group P&I clubs, plus common fixed-premium alternatives.
// The P&I field also allows free text for any insurer not listed.
export const PI_CLUBS: readonly string[] = [
  "Gard",
  "UK P&I Club",
  "Steamship Mutual",
  "Britannia P&I",
  "Skuld",
  "The Standard Club",
  "North of England (NorthStandard)",
  "The American Club",
  "Japan P&I Club",
  "London P&I Club",
  "Shipowners' Club",
  "Swedish Club",
  "West of England",
  // Common fixed-premium / non-IG insurers
  "Ingosstrakh",
  "MECOMS",
  "Turkish P&I",
  "Other / Fixed-premium",
];

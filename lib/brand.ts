// Central brand strings — one place to edit names/taglines used across the app
// (navbar, footer, emails, metadata, …). Plain constants, safe to import from
// both server and client components. If the app ever goes fully multilingual,
// this is the natural seam to swap for an i18n library.
export const BRAND = {
  /** English company name */
  nameEn: "Arab ShipBroker",
  /** Arabic company name */
  nameAr: "الوسيط العربي للسفن",
  /** Short region/sector tagline */
  taglineEn: "MENA Maritime",
  taglineAr: "بحرية الشرق الأوسط وشمال أفريقيا",
  /** Compact alternative if the long Arabic tagline is too wide: "مينا البحرية" */
} as const;

// Group Mail — shared types (client-safe, no server imports).

/** The sign-off block under the body. Default lives in Settings; every
 *  campaign carries its own editable copy so the sender can sign as themselves. */
export interface Signature {
  closing: string;  // "Sincerest Regards,"
  name: string;     // "Capt Mohamed Dawoud"
  role: string;     // "Founder · Arab ShipBroker" (optional)
  phone: string;    // "+20 …" (optional)
  email: string;    // reply address shown in the signature
  site: string;     // "www.arabshipbroker.com"
}

export const DEFAULT_SIGNATURE: Signature = {
  closing: "Sincerest Regards,",
  name: "As Brokers Only",
  role: "",
  phone: "",
  email: "circ@arabshipbroker.com",
  site: "www.arabshipbroker.com",
};

export function normalizeSignature(raw: unknown, fallbackEmail?: string | null): Signature {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Signature, unknown>>;
  const str = (v: unknown, d: string) => (typeof v === "string" ? v.trim() : d);
  return {
    closing: str(r.closing, DEFAULT_SIGNATURE.closing),
    name: str(r.name, DEFAULT_SIGNATURE.name),
    role: str(r.role, ""),
    phone: str(r.phone, ""),
    email: str(r.email, fallbackEmail ?? DEFAULT_SIGNATURE.email) || (fallbackEmail ?? DEFAULT_SIGNATURE.email),
    site: str(r.site, DEFAULT_SIGNATURE.site) || DEFAULT_SIGNATURE.site,
  };
}

export interface GroupMailConfig {
  cpanel_host: string | null;
  cpanel_user: string | null;
  mailman_base: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  from_name: string;
  test_recipients: string[] | null;
  signature: Signature | null; // default signature for new circulars
}

/** Which secrets are stored (never the values). */
export interface GroupMailSecretStatus {
  cpanel_token: boolean;
  smtp_password: boolean;
  lists: string[]; // list addresses that have an admin password saved
}

export interface MailingListRow {
  list: string;        // circulation@arabshipbroker.com
  listid: string;      // circulation_arabshipbroker.com
  humanname?: string;
  accesstype?: string; // 'public' | 'private'
  diskused?: string;
}

export interface ListMember {
  email: string;
  name: string | null;
}

export interface CampaignLink {
  label: string;
  url: string;
}

/** The two signature offices — the header date line renders in this zone. */
export const OFFICES = {
  Cairo: "Africa/Cairo",
  Dubai: "Asia/Dubai",
} as const;
export type Office = keyof typeof OFFICES;

/** Schedule-time zones — the region's main capitals (label → IANA zone).
 *  Scheduling stores the resolved UTC instant; the label is display-only. */
export const SCHEDULE_ZONES: Record<string, string> = {
  Cairo: "Africa/Cairo",
  Dubai: "Asia/Dubai",
  Riyadh: "Asia/Riyadh",
  Jeddah: "Asia/Riyadh",
  Doha: "Asia/Qatar",
  Kuwait: "Asia/Kuwait",
  Muscat: "Asia/Muscat",
  Baghdad: "Asia/Baghdad",
  Amman: "Asia/Amman",
  Beirut: "Asia/Beirut",
  Istanbul: "Europe/Istanbul",
  Athens: "Europe/Athens",
  Tripoli: "Africa/Tripoli",
  Tunis: "Africa/Tunis",
  Algiers: "Africa/Algiers",
  Casablanca: "Africa/Casablanca",
  London: "Europe/London",
  Mumbai: "Asia/Kolkata",
  Singapore: "Asia/Singapore",
};

export interface CampaignInput {
  list_email: string;
  badge: string;       // header pill, e.g. "Circulation"
  subject: string;
  title: string;       // headline inside the mail
  body: string;        // plain text; blank line = new paragraph
  links: CampaignLink[];
  office: Office;      // signature office for the date line
  signature?: Signature; // editable sign-off (defaults to Settings → Default signature)
}

export interface CampaignRow {
  id: string;
  list_email: string;
  mode: "test" | "broadcast";
  subject: string;
  recipients_total: number;
  sent_ok: number;
  sent_fail: number;
  status: "scheduled" | "sending" | "done" | "failed" | "canceled";
  created_at: string;
  finished_at: string | null;
  scheduled_at: string | null;
  schedule_tz: string | null;
  stamp_office: string | null;
}

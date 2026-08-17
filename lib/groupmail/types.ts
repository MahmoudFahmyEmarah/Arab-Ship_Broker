// Group Mail — shared types (client-safe, no server imports).

export interface GroupMailConfig {
  cpanel_host: string | null;
  cpanel_user: string | null;
  mailman_base: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  from_name: string;
  test_recipients: string[] | null;
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

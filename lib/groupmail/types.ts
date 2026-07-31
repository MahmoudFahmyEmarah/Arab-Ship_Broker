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

export interface CampaignInput {
  list_email: string;
  badge: string;       // header pill, e.g. "Circulation"
  subject: string;
  title: string;       // headline inside the mail
  body: string;        // plain text; blank line = new paragraph
  links: CampaignLink[];
}

export interface CampaignRow {
  id: string;
  list_email: string;
  mode: "test" | "broadcast";
  subject: string;
  recipients_total: number;
  sent_ok: number;
  sent_fail: number;
  status: "sending" | "done" | "failed";
  created_at: string;
  finished_at: string | null;
}

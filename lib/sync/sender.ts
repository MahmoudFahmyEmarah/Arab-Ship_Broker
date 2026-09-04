// Who sent the circular — the person and the company behind an ingested
// listing, so the market cards can show "who posted this" even when the
// listing was synced by admin rather than posted by a member.
//
// Inputs are what the email/WhatsApp source gives us:
//   from  : `"Kuzey Shipping" <chartering@kuzeyshipping.com>`
//   name  : WhatsApp push name, e.g. "Mr Francis - Pacific Shipping"
// Company resolution order: a registry hit on the sender's email domain
// (organizations.email_domains) → the display name when it reads like a firm →
// the "X - Company" suffix → the bare domain. Never invents a person.

export interface SenderInfo {
  contact: string | null;   // person or desk name as displayed
  company: string | null;   // best-effort firm name
  email: string | null;
  domain: string | null;
}

const FIRM_WORDS = /\b(shipping|chartering|maritime|marine|denizcilik|nakliyat|ltd|limited|s\.?a\.?|inc|llc|gmbh|srl|fzco|fze|dmcc|logistics|trading|broker|brokers|brokerage|navigation|lines|line|co\.?|company|group|holdings|agency|agencies|services|management|shipmanagement|carriers|tankers|bulk|freight|forwarding|international|intl|corp|corporation|plc|bv|nv|ab|as|oy|sas|sarl|pte|pty|est|enterprises)\b/i;

const GENERIC_MAILBOX = /^(info|chartering|ops|operations|sales|fixtures|office|mail|contact|admin|hello|desk|brokers?|snp|dry|bulk)$/i;

export function parseSender(from: string | null | undefined, pushName?: string | null, orgByDomain?: (domain: string) => string | null): SenderInfo {
  const f = (from ?? "").trim();
  const emailMatch = f.match(/<([^>]+)>/) ?? f.match(/([\w.+-]+@[\w.-]+\.\w+)/);
  const email = emailMatch ? emailMatch[1].trim().toLowerCase() : null;
  const domain = email && email.includes("@") ? email.split("@")[1] : null;
  let display = f.replace(/<[^>]*>/g, "").replace(/^[\s"']+|[\s"']+$/g, "").trim();
  if (display && email && display.toLowerCase() === email) display = "";
  const name = (pushName ?? "").trim() || display;

  // "Mr Francis - Pacific Shipping" → person + firm
  let contact: string | null = name || null;
  let company: string | null = null;
  const dash = name.match(/^(.+?)\s+[-–|]\s+(.+)$/);
  if (dash) {
    contact = dash[1].trim();
    company = dash[2].trim();
  }

  const orgHit = domain && orgByDomain ? orgByDomain(domain) : null;
  if (orgHit) company = orgHit;
  else if (!company) {
    if (name && FIRM_WORDS.test(name)) {
      company = name;
      // a firm-named mailbox has no person — keep contact as the desk name
    } else if (domain && !/^(gmail|hotmail|outlook|yahoo|icloud|live|proton|protonmail|mail|yandex)\./i.test(domain)) {
      company = domain;
    }
  }
  if (!contact && email) {
    const local = email.split("@")[0];
    contact = GENERIC_MAILBOX.test(local) ? (company ?? email) : local;
  }
  return { contact: contact || null, company: company || null, email, domain };
}

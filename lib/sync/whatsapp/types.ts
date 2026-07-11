// WhatsApp source — shared types.

export type WaProvider = "meta" | "unofficial";

export interface WaConfig {
  provider: WaProvider;
  phone_number_id: string | null;
  business_id: string | null;
  is_enabled: boolean;
  auto_reply: boolean;
  reply_template: string;
  platform_url: string;
}

export interface WaInboundMessage {
  id: string;             // whatsapp_message.id
  wa_message_id: string;
  provider: WaProvider;
  wa_from: string;        // meta: E.164 phone · unofficial: jid
  contact_name: string | null;
  body: string;
  received_at: string;
}

export interface WaRuntime {
  state: "offline" | "pairing" | "connected";
  qr: string | null;
  linked_as: string | null;
  worker_seen: string | null;
}

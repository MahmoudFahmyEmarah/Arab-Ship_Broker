import { SupabaseClient } from "@supabase/supabase-js";

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  how_did_you_find_us: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
};

export type ContactMessageInsert = Omit<
  ContactMessage,
  "id" | "created_at" | "is_read"
>;

const getContactMessagesTable = (supabase: SupabaseClient) => {
  return supabase.from("contact_messages");
};

export const sendMessage = async (
  supabase: SupabaseClient,
  payload: ContactMessageInsert,
) => {
  const { error } = await getContactMessagesTable(supabase).insert(payload);
  if (error) throw error;
  return true;
};

// app/(admin)/admin/messages/page.tsx
import Link from "next/link";
import { Mail } from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { MarkAllReadButton, MessageRow } from "@/components/admin/messages/MessageRow";
import type { AdminMessageRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();
  const filter = params.filter ?? "unread";

  let q = supabase
    .from("contact_messages")
    .select("*")
    .order("created_at", { ascending: false });

  if (filter === "unread") q = q.eq("is_read", false);
  if (filter === "read") q = q.eq("is_read", true);

  const { data } = await q.limit(200);
  const messages = (data ?? []) as AdminMessageRow[];

  const { data: counts } = await supabase
    .from("contact_messages")
    .select("is_read");

  const unreadCount = (counts ?? []).filter(
    (m: { is_read: boolean }) => !m.is_read,
  ).length;
  const totalCount = (counts ?? []).length;

  const FILTER_TABS = [
    { label: `Unread (${unreadCount})`, value: "unread" },
    { label: `All (${totalCount})`, value: "all" },
    { label: "Read", value: "read" },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Contact Messages"
        subtitle={`${unreadCount} unread · ${totalCount} total`}
      >
        {unreadCount > 0 && <MarkAllReadButton />}
      </AdminPageHeader>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 dp-card p-1 w-fit">
        {FILTER_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/messages?filter=${tab.value}`}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              filter === tab.value
                ? "bg-asb-blue text-white shadow-sm"
                : "text-asb-gray-500 hover:bg-asb-gray-50 hover:text-asb-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {messages.length === 0 ? (
        <div className="dp-card py-20 text-center">
          <Mail className="w-10 h-10 text-asb-gray-400 mx-auto mb-3" />
          <p className="text-asb-gray-500 font-semibold">
            {filter === "unread" ? "No unread messages" : "No messages"}
          </p>
          {filter === "unread" && unreadCount === 0 && (
            <p className="text-asb-gray-400 text-sm mt-1">
              All messages have been read.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <MessageRow key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}

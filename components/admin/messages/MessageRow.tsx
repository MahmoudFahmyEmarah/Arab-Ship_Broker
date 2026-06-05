"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Mail,
  MailOpen,
  Trash2,
  ChevronDown,
  ChevronUp,
  Phone,
  Loader2,
} from "lucide-react";
import {
  markMessageRead,
  deleteMessage,
} from "@/app/(admin)/admin/messages/actions";
import type { AdminMessageRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

export function MessageRow({ message: msg }: { message: AdminMessageRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(!msg.is_read);

  function act(
    fn: () => Promise<{ success: boolean; error?: string }>,
    successMsg: string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.success) {
        toast.success(successMsg);
        router.refresh();
      } else toast.error(r.error ?? "Action failed.");
    });
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div
      className={cn(
        "bg-white border rounded overflow-hidden transition-all",
        msg.is_read ? "border-asb-gray-200" : "border-asb-blue shadow-sm",
      )}
    >
      <div
        className="flex items-start gap-4 px-5 py-4 cursor-pointer hover:bg-asb-gray-50 transition-colors"
        onClick={() => {
          setExpanded((e) => !e);
          if (!msg.is_read)
            act(() => markMessageRead(msg.id, true), "Marked as read");
        }}
      >
        <div className="mt-0.5 shrink-0">
          {msg.is_read ? (
            <MailOpen className="w-5 h-5 text-asb-gray-400" />
          ) : (
            <Mail className="w-5 h-5 text-asb-blue" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-0.5">
            <p
              className={cn(
                "text-sm truncate",
                msg.is_read
                  ? "font-medium text-asb-ink-soft"
                  : "font-bold text-asb-navy",
              )}
            >
              {msg.name}
            </p>
            <p className="text-xs text-asb-gray-400">{msg.email}</p>
            {!msg.is_read && (
              <span className="text-[10px] font-bold text-asb-blue bg-asb-blue-light border border-asb-blue px-1.5 py-0.5 rounded">
                New
              </span>
            )}
          </div>
          <p
            className={cn(
              "text-sm truncate",
              msg.is_read ? "text-asb-gray-500" : "text-asb-ink-soft font-medium",
            )}
          >
            {msg.message.substring(0, 120)}
            {msg.message.length > 120 ? "…" : ""}
          </p>
          <p className="text-xs text-asb-gray-400 mt-1">
            {fmtDate(msg.created_at)}
          </p>
        </div>

        <div className="shrink-0 text-asb-gray-400">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-asb-gray-100">
          <div className="flex items-center gap-4 py-3 text-xs text-asb-gray-500 flex-wrap">
            <a
              href={`mailto:${msg.email}`}
              className="flex items-center gap-1.5 text-asb-blue hover:text-asb-blue font-semibold"
            >
              <Mail className="w-3.5 h-3.5" />
              {msg.email}
            </a>
            {msg.phone && (
              <a
                href={`tel:${msg.phone}`}
                className="flex items-center gap-1.5 text-asb-blue hover:text-asb-blue font-semibold"
              >
                <Phone className="w-3.5 h-3.5" />
                {msg.phone}
              </a>
            )}
            {msg.how_did_you_find_us && (
              <span>
                Found us via:{" "}
                <span className="font-medium text-asb-ink-soft">
                  {msg.how_did_you_find_us}
                </span>
              </span>
            )}
          </div>

          <div className="bg-asb-gray-50 rounded p-4 mb-4">
            <p className="text-sm text-asb-ink-soft leading-relaxed whitespace-pre-wrap">
              {msg.message}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`mailto:${msg.email}?subject=Re: Your Arab ShipBroker enquiry`}
              className="flex items-center gap-2 text-sm font-semibold text-white bg-asb-blue hover:bg-asb-navy px-4 py-2 rounded transition-colors"
            >
              <Mail className="w-4 h-4" />
              Reply via email
            </a>

            {msg.is_read ? (
              <button
                disabled={isPending}
                onClick={() =>
                  act(() => markMessageRead(msg.id, false), "Marked as unread")
                }
                className="flex items-center gap-1.5 text-xs font-semibold text-asb-gray-500 hover:bg-asb-gray-100 border border-asb-gray-200 px-3 py-2 rounded transition-colors disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                Mark unread
              </button>
            ) : (
              <button
                disabled={isPending}
                onClick={() =>
                  act(() => markMessageRead(msg.id, true), "Marked as read")
                }
                className="flex items-center gap-1.5 text-xs font-semibold text-asb-gray-500 hover:bg-asb-gray-100 border border-asb-gray-200 px-3 py-2 rounded transition-colors disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MailOpen className="w-3.5 h-3.5" />
                )}
                Mark read
              </button>
            )}

            <button
              disabled={isPending}
              onClick={() =>
                act(() => deleteMessage(msg.id), "Message deleted")
              }
              className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 border border-asb-gray-200 hover:border-red-200 px-3 py-2 rounded transition-colors disabled:opacity-50 ml-auto"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { markAllRead } from "@/app/(admin)/admin/messages/actions";

export function MarkAllReadButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const r = await markAllRead();
      if (r.success) {
        toast.success("All messages marked as read.");
        router.refresh();
      } else toast.error(r.error ?? "Action failed.");
    });
  };

  return (
    <button
      disabled={isPending}
      onClick={handleClick}
      className="flex items-center gap-2 text-sm font-semibold text-asb-gray-700 bg-white hover:bg-asb-gray-50 border border-asb-gray-200 px-4 py-2 rounded transition-colors disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <MailOpen className="w-4 h-4" />
      )}
      Mark all read
    </button>
  );
}

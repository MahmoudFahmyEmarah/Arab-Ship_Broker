"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { IconBell } from "./icons";

interface NotificationItem {
  id: string;
  kind: string;
  importance: "urgent" | "normal" | "info";
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

function ageLabel(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function safeNotificationHref(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = new URL("https://portal.arabshipbroker.invalid");
    const target = new URL(value, base);
    return target.origin === base.origin ? `${target.pathname}${target.search}${target.hash}` : null;
  } catch {
    return null;
  }
}

export function NotificationBell() {
  const router = useRouter();
  const client = React.useMemo(() => getSupabaseBrowserClient(), []);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [count, setCount] = React.useState(0);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);

  const refreshBadge = React.useCallback(async () => {
    const { data, error } = await client.rpc("notification_badge");
    if (error) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setCount(typeof data === "number" ? data : Number(data ?? 0));
  }, [client]);

  const refreshItems = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await client.rpc("list_my_notifications", { p_limit: 20, p_before: null });
    setLoading(false);
    if (error) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setItems((data ?? []) as NotificationItem[]);
  }, [client]);

  React.useEffect(() => {
    void refreshBadge();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBadge();
    }, 60_000);
    const onFocus = () => void refreshBadge();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBadge]);

  React.useEffect(() => {
    if (!open) return;
    void refreshItems();
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refreshItems]);

  const markRead = React.useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const unique = [...new Set(ids)].slice(0, 100);
    const { error } = await client.rpc("mark_notifications_read", { p_ids: unique });
    if (error) return;
    setItems((current) => current.map((item) => unique.includes(item.id) ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item));
    await refreshBadge();
  }, [client, refreshBadge]);

  const markAllRead = React.useCallback(async () => {
    const { error } = await client.rpc("mark_all_my_notifications_read");
    if (error) return;
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    await refreshBadge();
  }, [client, refreshBadge]);

  const openNotification = React.useCallback(async (id: string, href: string) => {
    await markRead([id]);
    setOpen(false);
    router.push(href);
  }, [markRead, router]);

  return (
    <div className="portal-notification" ref={rootRef} data-open={open ? "true" : "false"}>
      <button
        ref={buttonRef}
        type="button"
        className="portal-notification__trigger"
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls="portal-notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <IconBell size={17} />
        {count > 0 && <span className="portal-notification__badge" aria-hidden>{count > 99 ? "99+" : count}</span>}
      </button>

      {open && (
        <section id="portal-notification-panel" className="portal-notification__panel" role="region" aria-label="Notifications">
          <header className="portal-notification__head">
            <div>
              <strong>Notifications</strong>
              <span>{count ? `${count} unread` : "Up to date"}</span>
            </div>
            <button type="button" disabled={!count} onClick={() => void markAllRead()}>Mark all read</button>
          </header>
          <div className="portal-notification__list" aria-live="polite">
            {loading && <p className="portal-notification__state">Loading notifications…</p>}
            {!loading && unavailable && <p className="portal-notification__state">Notifications are temporarily unavailable.</p>}
            {!loading && !unavailable && !items.length && <p className="portal-notification__state">No notifications yet.</p>}
            {!loading && !unavailable && items.map((item) => {
              const safeHref = safeNotificationHref(item.href);
              const content = (
                <>
                  <span className={`portal-notification__dot is-${item.importance}`} aria-hidden />
                  <span className="portal-notification__copy">
                    <strong>
                      <span className="sr-only">
                        {item.read_at ? "Read " : "Unread "}
                        {item.importance === "urgent" ? "urgent notification: " : "notification: "}
                      </span>
                      {item.title}
                    </strong>
                    <span>{item.body}</span>
                  </span>
                  <time dateTime={item.created_at}>{ageLabel(item.created_at)}</time>
                </>
              );
              const className = `portal-notification__item${item.read_at ? " is-read" : " is-unread"}`;
              return safeHref ? (
                <Link key={item.id} href={safeHref} className={className} onClick={(event) => { event.preventDefault(); void openNotification(item.id, safeHref); }}>
                  {content}
                </Link>
              ) : (
                <button key={item.id} type="button" className={className} onClick={() => void markRead([item.id])}>
                  {content}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

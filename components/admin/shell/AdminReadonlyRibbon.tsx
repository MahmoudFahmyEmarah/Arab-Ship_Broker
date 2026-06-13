"use client";

// Read-only ribbon — renders above the page body when the current admin has
// only "view" access to the section they're on (matched from the pathname
// against the nav taxonomy). Edits on those pages are disabled server-side.
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { canAccess, type AdminTier, type AdminPerms } from "@/lib/admin/sections";

export function AdminReadonlyRibbon({
  tier,
  perms,
}: {
  tier: AdminTier;
  perms: AdminPerms | null;
}) {
  const pathname = usePathname();
  const item = ADMIN_NAV.flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!item) return null;
  if (canAccess(item.id, tier, perms) !== "view") return null;
  return (
    <div className="adm-readonly">
      <span>👁</span>
      You have <strong>view-only</strong> access to this section. Edits are disabled for your account.
    </div>
  );
}

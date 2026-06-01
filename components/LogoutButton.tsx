"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { logout } from "@/sdk/auth";

interface LogoutButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onComplete?: () => void;
}

export function LogoutButton({
  className,
  onComplete,
  ...props
}: LogoutButtonProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await logout(supabase);
      toast.success("Anchor raised! Logged out successfully.");
      router.push("/");
      if (onComplete) onComplete();
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Failed to log out. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={isLoggingOut || props.disabled}
      className={cn(
        "flex items-center justify-center gap-1.5 text-sm font-semibold rounded transition-all duration-300 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-asb-blue disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {isLoggingOut ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <LogOut className="w-4 h-4" />
      )}
      {isLoggingOut ? "Logging out..." : "Logout"}
    </button>
  );
}

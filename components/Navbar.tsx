"use client";

import {
  useState,
  useEffect,
  useSyncExternalStore,
  useTransition,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Menu,
  X,
  ArrowRight,
  LogIn,
  LayoutDashboard,
  Anchor,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { User } from "@supabase/supabase-js";

import { cn } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { LogoutButton } from "@/components/LogoutButton";

const navigation = [
  { name: "Services", href: "/services" },
  { name: "Contact", href: "/contact" },
];

function useScrolled(threshold = 28) {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("scroll", cb, { passive: true });
      return () => window.removeEventListener("scroll", cb);
    },
    () => (typeof window !== "undefined" ? window.scrollY > threshold : false),
    () => false,
  );
}

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [, startTransition] = useTransition();
  const pathname = usePathname();
  const scrolled = useScrolled();

  const isHeroPage =
    pathname === "/" ||
    pathname === "/services" ||
    pathname === "/contact" ||
    pathname?.startsWith("/auth");

  const showTransparent = isHeroPage && !scrolled && !mobileMenuOpen;

  useEffect(() => {
    startTransition(() => setMobileMenuOpen(false));
  }, [pathname, startTransition]);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsLoadingAuth(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      {isHeroPage && (
        <div
          className="fixed top-0 inset-x-0 z-50 h-px pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(16,163,188,0.35) 40%, rgba(16,163,188,0.5) 50%, rgba(16,163,188,0.35) 60%, transparent 100%)",
          }}
        />
      )}

      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-40 transition-all duration-500 ease-out",
          showTransparent
            ? "bg-transparent"
            : "bg-white/96 backdrop-blur-2xl border-b border-slate-200/60 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]",
        )}
      >
        <nav className="w-full px-8 max-lg:px-6 max-md:px-4">
          <div className="flex items-center justify-between h-17.5 max-lg:h-15.5">
            <Link
              href="/"
              className="flex items-center gap-3 min-w-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-500"
              aria-label="Arab ShipBroker"
            >
              <div
                className={cn(
                  "relative w-9 h-9 rounded-xl overflow-hidden shrink-0 transition-all duration-500 flex items-center justify-center",
                  showTransparent
                    ? "bg-white/12 ring-1 ring-white/18"
                    : "bg-ocean-50 ring-1 ring-ocean-100",
                )}
              >
                <Image
                  src="/logo.png"
                  alt=""
                  width={20}
                  height={20}
                  aria-hidden
                  className={cn(
                    "object-contain transition-all duration-300",
                    showTransparent && "brightness-0 invert",
                  )}
                />
              </div>
              <div className="flex flex-col leading-none min-w-0">
                <span
                  className={cn(
                    "font-bold text-[15px] tracking-tight truncate transition-colors duration-300",
                    showTransparent ? "text-white" : "text-ocean-950",
                  )}
                >
                  Arab ShipBroker
                </span>
                <span
                  className={cn(
                    "text-[9.5px] font-bold uppercase tracking-[0.2em] mt-0.75 transition-colors duration-300",
                    showTransparent ? "text-foam-300/70" : "text-foam-600/80",
                  )}
                >
                  MENA Maritime
                </span>
              </div>
            </Link>

            <div className="hidden md:flex items-center">
              <div className="flex items-center gap-0.5">
                {navigation.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "relative px-4 max-lg:px-2.5 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                        showTransparent
                          ? isActive
                            ? "text-white"
                            : "text-white/65 hover:text-white hover:bg-white/8"
                          : isActive
                            ? "text-ocean-700"
                            : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
                      )}
                    >
                      {item.name}
                      {isActive && (
                        <motion.div
                          layoutId="navbar-pill"
                          className={cn(
                            "absolute inset-0 rounded-xl -z-10",
                            showTransparent ? "bg-white/10" : "bg-ocean-50",
                          )}
                          transition={{
                            type: "spring",
                            bounce: 0.12,
                            duration: 0.45,
                          }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>

              <div
                className={cn(
                  "w-px h-4 mx-5 max-lg:mx-2.5 transition-colors duration-300",
                  showTransparent ? "bg-white/15" : "bg-slate-200",
                )}
                aria-hidden
              />

              {isLoadingAuth ? (
                <div className="h-9 w-36 rounded-xl bg-white/10 skeleton" />
              ) : user ? (
                <div className="flex items-center gap-1.5">
                  <Link
                    href="/dashboard"
                    className={cn(
                      "flex items-center gap-2 text-sm font-medium px-4 max-lg:px-2.5 py-2 rounded-xl transition-all duration-200",
                      showTransparent
                        ? "text-white/80 hover:text-white hover:bg-white/8"
                        : "text-slate-600 hover:text-ocean-700 hover:bg-ocean-50",
                    )}
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Portal
                  </Link>
                  <LogoutButton
                    className={cn(
                      "px-4 py-2 rounded-xl border text-sm font-medium transition-all duration-200",
                      showTransparent
                        ? "bg-white/8 text-white/75 border-white/15 hover:bg-white/14"
                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700",
                    )}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href="/auth/login"
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-medium px-4 max-lg:px-2.5 py-2 rounded-xl transition-all duration-200",
                      showTransparent
                        ? "text-white/75 hover:text-white hover:bg-white/8"
                        : "text-slate-500 hover:text-slate-900",
                    )}
                  >
                    <LogIn className="w-4 h-4" />
                    Sign in
                  </Link>
                  <Link
                    href="/auth/signup"
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-semibold px-5 max-lg:px-3.5 py-2.5 rounded-xl transition-all duration-200",
                      showTransparent
                        ? "bg-white text-ocean-950 hover:bg-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.15)]"
                        : "bg-ocean-600 text-white hover:bg-ocean-700 shadow-[0_1px_6px_rgba(45,109,168,0.25)]",
                    )}
                  >
                    Get Access
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}
            </div>

            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className={cn(
                "md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-all duration-200",
                showTransparent
                  ? "text-white/80 hover:text-white hover:bg-white/10"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                {mobileMenuOpen ? (
                  <motion.span
                    key="close"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    <X className="w-4.5 h-4.5" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="menu"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    <Menu className="w-4.5 h-4.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </nav>
      </header>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-30 bg-ocean-950/55 backdrop-blur-sm md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="fixed top-15.5 left-4 right-4 z-40 bg-white rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden md:hidden"
            >
              <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-slate-100">
                <div className="w-7 h-7 bg-ocean-50 rounded-lg flex items-center justify-center shrink-0">
                  <Anchor className="w-3.5 h-3.5 text-ocean-600" />
                </div>
                <span className="text-[11px] font-bold text-ocean-500 uppercase tracking-[0.18em]">
                  Arab ShipBroker
                </span>
                <span className="ml-auto text-[9px] font-bold text-foam-600 bg-foam-50 border border-foam-200/60 rounded-full px-2 py-0.5 uppercase tracking-wider">
                  Beta
                </span>
              </div>

              <div className="p-2">
                {navigation.map((item, i) => (
                  <motion.div
                    key={item.name}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 + 0.06 }}
                  >
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                        pathname === item.href
                          ? "bg-ocean-50 text-ocean-700"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      {item.name}
                    </Link>
                  </motion.div>
                ))}
              </div>

              <div className="p-3 pt-1 border-t border-slate-100 space-y-2">
                {user ? (
                  <>
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl bg-ocean-600 text-white font-semibold text-sm hover:bg-ocean-700 transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      Open Portal
                      <ArrowRight className="w-4 h-4 ml-auto" />
                    </Link>
                    <LogoutButton className="w-full justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 text-sm font-medium" />
                  </>
                ) : (
                  <>
                    <Link
                      href="/auth/login"
                      className="flex items-center justify-center gap-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
                    >
                      <LogIn className="w-4 h-4" />
                      Sign in
                    </Link>
                    <Link
                      href="/auth/signup"
                      className="flex items-center justify-center gap-1.5 w-full px-4 py-2.5 rounded-xl bg-ocean-600 text-white font-bold text-sm hover:bg-ocean-700 transition-colors"
                    >
                      Get Access
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

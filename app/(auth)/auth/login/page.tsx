"use client";

import { getAppUserRow } from "@/lib/app-user";
import { useEffect, useRef, useState } from "react";
import { motion, easeOut } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { normalizeRole } from "@/lib/role";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  Ship,
  ArrowRight,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { EmailNotVerifiedError, login } from "@/sdk/auth";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

// Animation variants matching the signup page [cite: 22, 23]
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
};

class SuspendedAccountError extends Error {
  constructor() {
    super("Account is suspended.");
    this.name = "SuspendedAccountError";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasShownSuspendedToast = useRef(false);
  // 2FA (TOTP) challenge — shown after the password when the account has a
  // verified authenticator factor (Supabase AAL aal1 -> aal2).
  const [mfa, setMfa] = useState<{ factorId: string; role: string | null } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (
      searchParams.get("error") === "account_suspended" &&
      !hasShownSuspendedToast.current
    ) {
      hasShownSuspendedToast.current = true;
      toast.error("Your account is suspended. Please contact support.");
    }
  }, [searchParams]);

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const authResult = await login(supabase, data);
      const userId = authResult.user?.id;

      let role: string | null = null;
      if (userId) {
        const dbUser = await getAppUserRow<{ role?: string; is_active?: boolean }>(
          supabase, userId, "role, is_active");

        if (dbUser && dbUser.is_active === false) {
          await supabase.auth.signOut();
          throw new SuspendedAccountError();
        }

        role = normalizeRole(dbUser?.role);
      }

      // If the account has a verified authenticator, require the TOTP code.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.find((f) => f.status === "verified") ?? factors?.totp?.[0];
        if (totp) {
          setMfa({ factorId: totp.id, role });
          setMfaCode("");
          setIsSubmitting(false);
          return;
        }
      }

      toast.success("Welcome back! Dropping anchor in your dashboard...");
      router.push(role === "admin" ? "/admin/dashboard" : "/dashboard");
    } catch (error) {
      console.error("Login error:", error);

      if (error instanceof EmailNotVerifiedError) {
        toast.error(
          error.otpSent
            ? "Your email is not verified yet. We sent a new OTP to your inbox."
            : "Your email is not verified yet. Please request a new OTP on the verification page.",
        );
        router.push(
          `/auth/verify-email?email=${encodeURIComponent(error.email)}`,
        );
        return;
      }

      if (error instanceof SuspendedAccountError) {
        toast.error("Your account is suspended. Please contact support.");
        router.push("/auth/login?error=account_suspended");
        return;
      }

      toast.error("Invalid email or password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyMfa = async () => {
    if (!mfa || mfaCode.trim().length < 6) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setMfaBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: mfa.factorId,
        code: mfaCode.trim(),
      });
      if (error) throw error;
      toast.success("Welcome back! Dropping anchor in your dashboard...");
      router.push(mfa.role === "admin" ? "/admin/dashboard" : "/dashboard");
    } catch {
      toast.error("That code didn't match. Try again.");
    } finally {
      setMfaBusy(false);
    }
  };

  const cancelMfa = async () => {
    try {
      await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
    } catch {}
    setMfa(null);
    setMfaCode("");
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 selection:bg-ocean-600/30">
      {/* Background Image  */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-1000 scale-105"
        style={{ backgroundImage: "url('/1.jpeg')" }}
      />
      <div className="absolute inset-0 bg-ocean-950/40 backdrop-blur-[2px]" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 max-[768px]:p-8 border border-white/20 ring-1 ring-ocean-950/5">
          {/* Brand Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="mx-auto w-12 h-12 bg-ocean-50 text-ocean-600 rounded flex items-center justify-center mb-4 shadow-sm border border-slate-200"
            >
              <Ship className="w-6 h-6" />
            </motion.div>
            <h1 className="text-3xl font-bold text-ocean-900 tracking-tight mb-2">
              Welcome Back
            </h1>
            <p className="text-slate-500 text-sm">
              Sign in to manage your maritime operations.
            </p>
          </div>

          {mfa ? (
            <div className="space-y-5">
              <p className="text-slate-700 text-sm text-center -mt-4 mb-1">
                Two-factor authentication — enter the 6-digit code from your authenticator app.
              </p>
              <Input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") void verifyMfa(); }}
                className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-600 focus:ring-ocean-600/20 h-12 text-center tracking-[0.4em] text-lg rounded"
              />
              <Button
                type="button"
                onClick={verifyMfa}
                disabled={mfaBusy}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-base shadow-md flex items-center justify-center"
              >
                {mfaBusy ? (<><Loader2 className="animate-spin mr-2 w-5 h-5" />Verifying...</>) : "Verify"}
              </Button>
              <button type="button" onClick={cancelMfa} className="w-full text-center text-xs text-slate-500 hover:text-slate-700">
                Cancel and sign out
              </button>
            </div>
          ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-4"
              >
                {/* Email Field */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                          Email Address
                        </FormLabel>
                        <FormControl>
                          <div className="relative group">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-ocean-600 transition-colors" />
                            <Input
                              {...field}
                              type="email"
                              placeholder="captain@arabship.com"
                              className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-600  focus:ring-ocean-600/20 pl-10 h-11 transition-all rounded"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Password Field */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                            Password
                          </FormLabel>
                          <Link
                            href="/auth/forgot-password"
                            title="Coming soon"
                            className="text-xs font-medium text-ocean-600 hover:text-ocean-600"
                          >
                            Forgot?
                          </Link>
                        </div>
                        <FormControl>
                          <div className="relative group">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-ocean-600 transition-colors" />
                            <Input
                              {...field}
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••"
                              className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-600  focus:ring-ocean-600/20 pl-10 pr-10 h-11 transition-all rounded"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 focus:outline-none"
                            >
                              {showPassword ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Submit Button */}
                <motion.div variants={itemVariants} className="pt-4">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center group"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin mr-2 w-5 h-5" />
                        Authenticating...
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </Button>
                </motion.div>
              </motion.div>
            </form>
          </Form>
          )}

          {/* Footer Navigation */}
          <div className="text-center mt-8 pt-6 border-t border-slate-100">
            <p className="text-slate-700 text-sm">
              New to Arab ShipBroker?{" "}
              <Link
                href="/auth/signup"
                className="text-ocean-600 hover:text-ocean-600 font-semibold hover:underline underline-offset-4 transition-all"
              >
                Create your account
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

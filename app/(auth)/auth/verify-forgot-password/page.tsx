"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { motion, easeOut } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { verifyRecoveryOtp, sendForgotPasswordEmail } from "@/sdk/auth";

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

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const lastResendAt = useRef(0);

  useEffect(() => {
    if (!email) {
      toast.error("Missing email address. Please restart recovery process.");
      router.push("/auth/forgot-password");
    } else if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [email, router]);

  const handleChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(0, 1);
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "");
    const digits = pastedData.slice(0, 6).split("");
    const newCode = [...code];
    digits.forEach((digit, index) => {
      if (index < 6) newCode[index] = digit;
    });
    setCode(newCode);
    const nextIndex = Math.min(digits.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const verificationCode = code.join("");

    if (verificationCode.length !== 6) {
      toast.error("Please enter the complete 6-digit code.");
      return;
    }

    if (!email) return;

    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await verifyRecoveryOtp(supabase, email, verificationCode);
      toast.success("Identity verified! You may now reset your password.");
      router.push("/auth/reset-password");
    } catch (error) {
      console.error("Verification error:", error);
      const msg = error instanceof Error ? error.message : "";
      // A newer code invalidates every earlier one — the usual cause of a
      // fresh-looking code failing is reading an older email.
      if (/expired or is invalid/i.test(msg)) {
        toast.error(
          "This code is no longer valid — it may have been replaced by a newer one. Press Resend, then use the code from the NEWEST email.",
          { duration: 8000 },
        );
      } else {
        toast.error("Invalid or expired verification code.");
      }
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (!email) return;
    // Cooldown: each resend kills all earlier codes — rapid resends only
    // create more dead emails to trip over.
    const now = Date.now();
    if (now - lastResendAt.current < 60_000) {
      const wait = Math.ceil((60_000 - (now - lastResendAt.current)) / 1000);
      toast.info(`A code was just sent — wait ${wait}s before requesting another. Only the newest email works.`);
      return;
    }
    setIsResending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await sendForgotPasswordEmail(supabase, email);
      lastResendAt.current = now;
      toast.success("New code sent — use the code from the NEWEST email (older codes stop working).", { duration: 8000 });
    } catch {
      toast.error("Failed to resend code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 max-[768px]:p-8 border border-white/20 ring-1 ring-ocean-950/5">
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
          className="mx-auto w-12 h-12 text-ocean-600 flex items-center justify-center mb-4"
        >
          <ShieldCheck className="w-9 h-9" />
        </motion.div>
        <h1 className="text-3xl font-bold text-ocean-900 tracking-tight mb-2">
          Verify Identity
        </h1>
        <p className="text-slate-500 text-sm">
          Enter the 6-digit code sent to <br />{" "}
          <span className="font-semibold text-slate-700">{email}</span>
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          <motion.div
            variants={itemVariants}
            className="flex justify-center gap-3 max-[768px]:gap-2"
          >
            {code.map((digit, index) => (
              <Input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                aria-label={`Digit ${index + 1}`}
                className="w-14 h-16 max-[768px]:w-12 max-[768px]:h-14 text-center text-xl font-bold bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-600  focus:ring-ocean-600/20 rounded transition-all"
              />
            ))}
          </motion.div>

          <motion.div variants={itemVariants} className="text-center">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={isResending}
              className="text-sm text-ocean-600 hover:text-ocean-600 font-semibold disabled:opacity-50 transition-colors"
            >
              {isResending
                ? "Dispatching new code..."
                : "Didn't receive a code? Resend"}
            </button>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Button
              type="submit"
              disabled={isSubmitting || code.join("").length !== 6}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center group disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin mr-2 w-5 h-5" />
                  Verifying...
                </>
              ) : (
                "Confirm Identity"
              )}
            </Button>
          </motion.div>
        </motion.div>
      </form>

      <div className="text-center mt-8 pt-6 border-t border-slate-100">
        <Link
          href="/auth/login"
          className="text-slate-500 hover:text-ocean-600 text-sm font-medium transition-colors"
        >
          Cancel and return to Sign In
        </Link>
      </div>
    </div>
  );
}

export default function VerificationPage() {
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 selection:bg-ocean-600/30">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-1000 scale-105"
        style={{ backgroundImage: "url('/5.jpeg')" }}
      />
      <div className="absolute inset-0 bg-ocean-950/40 backdrop-blur-[2px]" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <Suspense
          fallback={
            <div className="h-96 w-full bg-white/90 rounded-3xl animate-pulse" />
          }
        >
          <VerifyForm />
        </Suspense>
      </motion.div>
    </div>
  );
}

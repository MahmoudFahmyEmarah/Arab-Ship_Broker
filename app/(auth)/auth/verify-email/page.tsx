"use client";

import { Suspense, useEffect } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { verifyEmailOtp } from "@/sdk/auth";
import { OtpForm } from "@/components/OtpForm";

function EmailVerifyLogic() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  useEffect(() => {
    if (!email) {
      toast.error("Missing email address. Please sign up again.");
      router.push("/auth/signup");
    }
  }, [email, router]);

  if (!email) return null;

  const handleVerify = async (code: string) => {
    if (code.length !== 6) {
      toast.error("Please enter the complete 6-digit code.");
      throw new Error("Invalid code length");
    }

    const supabase = getSupabaseBrowserClient();
    try {
      await verifyEmailOtp(supabase, email, code);
      toast.success("Email verified successfully! Welcome aboard.");
      router.push("/auth/login");
    } catch (error) {
      console.error("Verification error:", error);
      toast.error("Invalid or expired verification code.");
      throw error;
    }
  };

  const handleResend = async () => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email,
      });
      if (error) throw error;
      toast.success("Verification code resent! Check your email.");
    } catch (error) {
      console.error("Resend error:", error);
      toast.error("Failed to resend code. Please try again.");
      throw error;
    }
  };

  return (
    <OtpForm
      email={email}
      title="Activate Account"
      description="Enter the 6-digit activation code sent to"
      buttonText="Verify & Continue"
      loadingText="Activating..."
      cancelHref="/auth/signup"
      onVerify={handleVerify}
      onResend={handleResend}
    />
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 selection:bg-ocean-500/30">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-1000 scale-105"
        style={{ backgroundImage: "url('/5.jpeg')" }}
      />
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />

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
          <EmailVerifyLogic />
        </Suspense>
      </motion.div>
    </div>
  );
}

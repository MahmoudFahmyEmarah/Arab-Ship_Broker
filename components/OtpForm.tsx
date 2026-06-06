"use client";

import { useState, useRef, useEffect } from "react";
import { motion, easeOut } from "framer-motion";
import Link from "next/link";
import { ShieldCheck, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

interface OtpFormProps {
  email: string;
  title: string;
  description: string;
  buttonText: string;
  loadingText: string;
  cancelHref: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
}

export function OtpForm({
  email,
  title,
  description,
  buttonText,
  loadingText,
  cancelHref,
  onVerify,
  onResend,
}: OtpFormProps) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onVerify(code.join(""));
    } finally {
      setIsSubmitting(false);
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    }
  };

  const handleResendClick = async () => {
    setIsResending(true);
    try {
      await onResend();
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
          className="mx-auto w-12 h-12 bg-ocean-50 text-ocean-600 rounded flex items-center justify-center mb-4 shadow-sm border border-slate-200"
        >
          <ShieldCheck className="w-6 h-6" />
        </motion.div>
        <h1 className="text-3xl font-bold text-ocean-900 tracking-tight mb-2">
          {title}
        </h1>
        <p className="text-slate-500 text-sm">
          {description} <br />{" "}
          <span className="font-semibold text-slate-700">{email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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
              onClick={handleResendClick}
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
                  {loadingText}
                </>
              ) : (
                buttonText
              )}
            </Button>
          </motion.div>
        </motion.div>
      </form>

      <div className="text-center mt-8 pt-6 border-t border-slate-100">
        <Link
          href={cancelHref}
          className="text-slate-500 hover:text-ocean-600 text-sm font-medium transition-colors"
        >
          Cancel and return
        </Link>
      </div>
    </div>
  );
}

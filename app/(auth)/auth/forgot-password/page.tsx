"use client";

import { useState } from "react";
import { motion, easeOut } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, ArrowRight, Loader2, Key } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { sendForgotPasswordEmail } from "@/sdk/auth";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

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

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await sendForgotPasswordEmail(supabase, data.email);

      toast.success("Reset code dispatched! Check your email.");
      router.push(`/auth/verify-email?email=${encodeURIComponent(data.email)}`);
    } catch (error) {
      console.error("Forgot password error:", error);
      toast.error("Failed to send reset email. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 selection:bg-asb-blue/30">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-1000 scale-105"
        style={{ backgroundImage: "url('/3.jpeg')" }}
      />
      <div className="absolute inset-0 bg-asb-navy-deep/40 backdrop-blur-[2px]" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 max-[768px]:p-8 border border-white/20 ring-1 ring-asb-navy-deep/5">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="mx-auto w-12 h-12 bg-asb-blue-light text-asb-blue rounded flex items-center justify-center mb-4 shadow-sm border border-asb-gray-200"
            >
              <Key className="w-6 h-6" />
            </motion.div>
            <h1 className="text-3xl font-bold text-asb-navy tracking-tight mb-2">
              Recover Password
            </h1>
            <p className="text-asb-gray-500 text-sm">
              Enter your email and we&apos;ll send you a secure verification
              code.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-4"
              >
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-asb-ink-soft font-semibold text-xs uppercase tracking-wider">
                          Email Address
                        </FormLabel>
                        <FormControl>
                          <div className="relative group">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-asb-gray-400 w-4 h-4 group-focus-within:text-asb-blue transition-colors" />
                            <Input
                              {...field}
                              type="email"
                              placeholder="captain@arabship.com"
                              className="bg-asb-gray-50 border-asb-gray-200 focus:bg-white focus:border-asb-blue  focus:ring-asb-blue/20 pl-10 h-11 transition-all rounded"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </motion.div>

                <motion.div variants={itemVariants} className="pt-4">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center group"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin mr-2 w-5 h-5" />
                        Sending...
                      </>
                    ) : (
                      <>
                        Send Recovery Code
                        <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </Button>
                </motion.div>
              </motion.div>
            </form>
          </Form>

          <div className="text-center mt-8 pt-6 border-t border-asb-gray-100">
            <p className="text-asb-gray-700 text-sm">
              Remembered your password?{" "}
              <Link
                href="/auth/login"
                className="text-asb-blue hover:text-asb-blue font-semibold hover:underline underline-offset-4 transition-all"
              >
                Return to Sign In
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

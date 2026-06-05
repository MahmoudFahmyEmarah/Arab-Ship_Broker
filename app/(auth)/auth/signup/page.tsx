"use client";

import { useState } from "react";
import { motion, easeOut } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Ship,
  Package,
  ArrowRight,
  Loader2,
  CheckSquare,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { signupAction } from "./actions";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { ProfileType } from "@/lib/schemas/account";

const signupSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    wantsCargo: z.boolean(),
    wantsVessel: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.wantsCargo || data.wantsVessel, {
    message: "Please select at least one profile type",
    path: ["wantsCargo"],
  });

type SignupFormData = z.infer<typeof signupSchema>;

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

function ProfileTile({
  label,
  description,
  icon: Icon,
  selected,
  onToggle,
}: {
  label: string;
  description: string;
  icon: React.ElementType;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`
        relative flex items-start gap-3 rounded border-2 p-4 text-left transition-all
        ${
          selected
            ? "border-asb-blue bg-asb-blue-light ring-2 ring-asb-blue/20"
            : "border-asb-gray-200 bg-asb-gray-50 hover:border-asb-gray-200"
        }
      `}
    >
      <div
        className={`
          shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors
          ${selected ? "bg-asb-blue text-white" : "bg-asb-gray-200 text-asb-gray-500"}
        `}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span
            className={`font-semibold text-sm ${selected ? "text-asb-blue" : "text-asb-ink-soft"}`}
          >
            {label}
          </span>
          {selected ? (
            <CheckSquare className="w-4 h-4 text-asb-blue" />
          ) : (
            <Square className="w-4 h-4 text-asb-gray-400" />
          )}
        </div>
        <p className="text-xs text-asb-gray-500 mt-0.5">{description}</p>
      </div>
    </button>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      wantsCargo: false,
      wantsVessel: false,
    },
  });

  const wantsCargo = form.watch("wantsCargo");
  const wantsVessel = form.watch("wantsVessel");

  const onSubmit = async (data: SignupFormData) => {
    setIsSubmitting(true);
    try {
      const profiles: ProfileType[] = [];
      if (data.wantsCargo) profiles.push("cargo");
      if (data.wantsVessel) profiles.push("vessel");

      const result = await signupAction({
        name: data.name,
        email: data.email,
        password: data.password,
        profiles,
      });

      if (result.success) {
        toast.success("Account created successfully! Welcome aboard.");
        router.push(
          `/auth/verify-email?email=${encodeURIComponent(data.email)}`,
        );
      } else {
        toast.error(result.error || "Failed to create account");
      }
    } catch (error) {
      console.error("Signup error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 selection:bg-asb-blue/30">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-1000 scale-105"
        style={{ backgroundImage: "url('/2.jpeg')" }}
      />
      <div className="absolute inset-0 bg-asb-navy-deep/40 backdrop-blur-[2px]" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-lg"
      >
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 max-[768px]:p-8 border border-white/20 ring-1 ring-asb-navy-deep/5">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="mx-auto w-12 h-12 bg-asb-blue-light text-asb-blue rounded flex items-center justify-center mb-4 shadow-sm border border-asb-gray-200"
            >
              <Ship className="w-6 h-6" />
            </motion.div>
            <h1 className="text-3xl font-bold text-asb-navy tracking-tight mb-2">
              Join Arab ShipBroker
            </h1>
            <p className="text-asb-gray-500 text-sm max-w-sm mx-auto">
              Create your account. You can activate a Cargo profile, a Vessel
              profile, or both — you can add more later.
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
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-asb-ink-soft font-semibold text-xs uppercase tracking-wider">
                          Full Name
                        </FormLabel>
                        <FormControl>
                          <div className="relative group">
                            <User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-asb-gray-400 w-4 h-4 group-focus-within:text-asb-blue transition-colors" />
                            <Input
                              {...field}
                              placeholder="e.g. Captain Ahab"
                              autoFocus
                              className="bg-asb-gray-50 border-asb-gray-200 focus:bg-white focus:border-asb-blue  focus:ring-asb-blue/20 pl-10 h-11 transition-all rounded"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </motion.div>

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
                            <Mail className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-asb-gray-400 w-4 h-4 group-focus-within:text-asb-blue transition-colors" />
                            <Input
                              {...field}
                              type="email"
                              placeholder="hello@example.com"
                              className="bg-asb-gray-50 border-asb-gray-200 focus:bg-white focus:border-asb-blue  focus:ring-asb-blue/20 pl-10 h-11 transition-all rounded"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </motion.div>

                <motion.div variants={itemVariants}>
                  <div className="space-y-2">
                    <p className="text-asb-ink-soft font-semibold text-xs uppercase tracking-wider">
                      I want to...{" "}
                      <span className="normal-case font-normal text-asb-gray-400">
                        (select one or both)
                      </span>
                    </p>
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-3">
                      <ProfileTile
                        label="Post Cargo"
                        description="I have cargo that needs a vessel"
                        icon={Package}
                        selected={wantsCargo}
                        onToggle={() =>
                          form.setValue("wantsCargo", !wantsCargo, {
                            shouldValidate: true,
                          })
                        }
                      />
                      <ProfileTile
                        label="List Vessels"
                        description="I have vessels looking for cargo"
                        icon={Ship}
                        selected={wantsVessel}
                        onToggle={() =>
                          form.setValue("wantsVessel", !wantsVessel, {
                            shouldValidate: true,
                          })
                        }
                      />
                    </div>
                    {form.formState.errors.wantsCargo && (
                      <p className="text-xs text-red-500 mt-1">
                        {form.formState.errors.wantsCargo.message}
                      </p>
                    )}
                  </div>
                </motion.div>

                <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                  <motion.div variants={itemVariants}>
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-asb-ink-soft font-semibold text-xs uppercase tracking-wider">
                            Password
                          </FormLabel>
                          <FormControl>
                            <div className="relative group">
                              <Lock className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-asb-gray-400 w-4 h-4 group-focus-within:text-asb-blue transition-colors" />
                              <Input
                                {...field}
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••"
                                className="bg-asb-gray-50 border-asb-gray-200 focus:bg-white focus:border-asb-blue  focus:ring-asb-blue/20 pl-10 pr-10 h-11 transition-all rounded"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-asb-gray-400 hover:text-asb-gray-700 focus:outline-none"
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

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-asb-ink-soft font-semibold text-xs uppercase tracking-wider">
                            Confirm Password
                          </FormLabel>
                          <FormControl>
                            <div className="relative group">
                              <Lock className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-asb-gray-400 w-4 h-4 group-focus-within:text-asb-blue transition-colors" />
                              <Input
                                {...field}
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="••••••••"
                                className="bg-asb-gray-50 border-asb-gray-200 focus:bg-white focus:border-asb-blue  focus:ring-asb-blue/20 pl-10 pr-10 h-11 transition-all rounded"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowConfirmPassword(!showConfirmPassword)
                                }
                                className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-asb-gray-400 hover:text-asb-gray-700 focus:outline-none"
                              >
                                {showConfirmPassword ? (
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
                </div>

                <motion.div variants={itemVariants} className="pt-4">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center group"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin mr-2 w-5 h-5" />
                        Setting up your account...
                      </>
                    ) : (
                      <>
                        Create Account
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
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="text-asb-blue hover:text-asb-blue font-semibold hover:underline underline-offset-4 transition-all"
              >
                Sign in to your dashboard
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

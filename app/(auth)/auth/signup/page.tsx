"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  LockKeyhole,
  User,
  ArrowRight,
  Loader2,
  Info,
} from "lucide-react";

import { IconCargo, IconVessel } from "@/components/portal/icons";
import { signupAction } from "./actions";
import type { ProfileType } from "@/lib/schemas/account";

// Pre_Final §10 signup tokens (Signup.html is the pixel source of truth).
const NAVY = "#1B3A5C";

const signupSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    role: z.enum(["vessel", "cargo", "broker"]),
    companyMode: z.enum(["none", "register", "join"]),
    companyName: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine(
    (data) => data.companyMode === "none" || data.companyName.trim().length >= 2,
    { message: "Please enter your company name", path: ["companyName"] },
  );

type SignupFormData = z.infer<typeof signupSchema>;

// Design copy — exact, do not rephrase (Pre_Final §10).
// Interest-framed choices: each maps directly to the workspace(s) you'll see.
// vessels-only → vessel profile · cargo-only → cargo profile · both → both.
const ROLE_OPTIONS = [
  {
    id: "vessel",
    title: "Vessels only",
    desc: "Owner, operator or owner's broker with open tonnage — vessel workspace",
  },
  {
    id: "cargo",
    title: "Cargo only",
    desc: "Charterer, shipper, forwarder or charterer's broker — cargo workspace",
  },
  {
    id: "broker",
    title: "Both cargo & vessels",
    desc: "Work both sides — get the cargo and the vessel workspace",
  },
] as const;

const COMPANY_SEGMENTS = [
  ["none", "Just me"],
  ["register", "Register company"],
  ["join", "Join my team"],
] as const;

// The role chips reuse the portal sidebar glyphs (IconVessel / IconCargo); the
// broker option is the sidebar's two-linked-circles match glyph.
function BrokerGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
    >
      <circle cx="4" cy="4" r="2" />
      <circle cx="10" cy="10" r="2" />
      <path d="M5.5 5.5 L8.5 8.5" />
    </svg>
  );
}

const FIELD_LABEL =
  "block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#8B95A3] mb-1.5";
const INPUT =
  "w-full h-10 rounded-lg border border-[#DDE2EA] bg-white pl-9.5 pr-3.5 text-sm text-[#1A1A1A] placeholder:text-[#B6BFCC] transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-[#185FA5] focus:shadow-[0_0_0_3px_rgba(24,95,165,0.12)]";
const INPUT_ICON =
  "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B6BFCC] pointer-events-none";

export default function SignupPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "vessel",
      companyMode: "none",
      companyName: "",
    },
  });

  const role = form.watch("role");
  const companyMode = form.watch("companyMode");
  const { errors } = form.formState;

  // Fit-to-window (Pre_Final §10): on desktop/tablet the card must never show
  // an internal scrollbar — scale it down when the viewport is shorter than
  // the card. Mobile (≤640px) scrolls the page naturally instead.
  useEffect(() => {
    const fitCard = () => {
      const card = cardRef.current;
      if (!card) return;
      if (window.innerWidth <= 640) {
        card.style.transform = "";
        return;
      }
      card.style.transform = "";
      const avail = window.innerHeight - 24;
      const h = card.offsetHeight;
      if (h > avail) card.style.transform = `scale(${(avail / h).toFixed(4)})`;
    };
    fitCard();
    window.addEventListener("resize", fitCard);
    return () => window.removeEventListener("resize", fitCard);
  }, [companyMode]);

  const onSubmit = async (data: SignupFormData) => {
    setIsSubmitting(true);
    try {
      // Workspace mapping (portal sidebar visibility rules): vessel side gets
      // the vessel persona, cargo side the cargo persona, broker gets both.
      const profiles: ProfileType[] =
        data.role === "vessel" ? ["vessel"]
        : data.role === "cargo" ? ["cargo"]
        : ["cargo", "vessel"];
      // The declaration keeps the market side; the design folds principals
      // and their brokers into one side-oriented choice.
      const declaredRole =
        data.role === "vessel" ? ("principal_owner" as const)
        : data.role === "cargo" ? ("principal_charterer" as const)
        : ("broker_dual" as const);

      const result = await signupAction({
        name: data.name,
        email: data.email,
        password: data.password,
        profiles,
        declaredRole,
        company:
          data.companyMode === "none"
            ? null
            : { mode: data.companyMode, name: data.companyName },
      });

      if (result.success) {
        toast.success("Account created successfully! Welcome aboard.");
        router.push(`/auth/verify-email?email=${encodeURIComponent(data.email)}`);
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
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0d2240] px-4 max-sm:px-3.5 max-sm:items-start pt-24 pb-10 max-sm:pt-20">
      {/* Full-bleed harbour photo + navy scrim (sits under the fixed navbar) */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/harbour-goldenhour.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(200deg, rgba(13,34,64,0.10) 0%, rgba(13,34,64,0.42) 58%, rgba(9,24,46,0.78) 100%)",
          }}
        />
        {/* Brand message, bottom-left of the photo (hidden under 980px) */}
        <div className="absolute bottom-11 left-12 max-w-[480px] hidden min-[980px]:block">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/65 mb-3">
            MENA Maritime Network
          </div>
          <h2 className="text-[28px] font-semibold text-white tracking-[-0.015em] leading-[1.3] mb-2.5 text-pretty">
            Cargo and tonnage, matched on one screen.
          </h2>
          <p className="text-sm text-white/80 leading-relaxed text-pretty">
            Post positions, work the market map, and fix faster with verified
            counterparts across the region.
          </p>
        </div>
      </div>

      {/* Floating card */}
      <div
        ref={cardRef}
        className="relative z-10 w-[480px] max-w-full shrink-0 bg-white rounded-2xl shadow-[0_24px_64px_-16px_rgba(6,18,36,0.55),0_0_0_1px_rgba(255,255,255,0.08)] origin-center max-sm:w-full"
      >
        <div className="px-7.5 pt-4.5 pb-4 max-sm:px-5 max-sm:pt-5 max-sm:pb-4.5">
          {/* Brand row */}
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Image
              src="/asb-anchor-logo.png"
              alt="Arab ShipBroker"
              width={38}
              height={38}
              className="h-9.5 w-auto"
            />
            <span className="flex items-center gap-2 text-base font-bold text-[#1B3A5C] tracking-[-0.01em] leading-none">
              Arab ShipBroker
              <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#185FA5] bg-[#E6F1FB] px-1.75 py-0.75 rounded-full leading-none">
                Beta
              </span>
            </span>
          </div>

          <h1 className="text-[21px] font-bold text-[#1B3A5C] tracking-[-0.015em] leading-[1.2] mb-1.25">
            Create your account
          </h1>
          <p className="text-[12.5px] text-[#4B5566] leading-normal mb-2.5">
            Join the MENA chartering network. Activate a cargo profile, a vessel
            profile, or both. You can add more later.
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Full name + Work email */}
            <div className="grid grid-cols-2 gap-3 mb-2.75 max-sm:grid-cols-1 max-sm:gap-2.75">
              <div>
                <label className={FIELD_LABEL} htmlFor="f-name">
                  Full name
                </label>
                <div className="relative">
                  <User className={INPUT_ICON} />
                  <input
                    id="f-name"
                    type="text"
                    placeholder="Your name"
                    autoComplete="name"
                    className={INPUT}
                    {...form.register("name")}
                  />
                </div>
                {errors.name && (
                  <p className="text-[11px] text-red-500 mt-1">{errors.name.message}</p>
                )}
              </div>
              <div>
                <label className={FIELD_LABEL} htmlFor="f-email">
                  Work email
                </label>
                <div className="relative">
                  <Mail className={INPUT_ICON} />
                  <input
                    id="f-email"
                    type="email"
                    placeholder="name@company.com"
                    autoComplete="email"
                    className={INPUT}
                    {...form.register("email")}
                  />
                </div>
                {errors.email && (
                  <p className="text-[11px] text-red-500 mt-1">{errors.email.message}</p>
                )}
              </div>
            </div>

            {/* Role selector — stacked radio rows with portal sidebar glyphs */}
            <div className="mb-2.75">
              <span className={FIELD_LABEL}>I am here to…</span>
              <div className="flex flex-col gap-1">
                {ROLE_OPTIONS.map((opt) => {
                  const selected = role === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => form.setValue("role", opt.id)}
                      className={`flex items-center gap-2.75 w-full text-left px-3 py-1.5 rounded-[10px] border transition-[border-color,background,box-shadow] duration-150 cursor-pointer ${
                        selected
                          ? "border-[#185FA5] bg-[#F7FBFF] shadow-[0_0_0_3px_rgba(24,95,165,0.10)]"
                          : "border-[#DDE2EA] bg-white hover:border-[#B6BFCC]"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors duration-150 ${
                          selected ? "bg-[#1B3A5C] text-white" : "bg-[#EDF1F6] text-[#4B5566]"
                        }`}
                      >
                        {opt.id === "vessel" ? (
                          <IconVessel size={18} fleck={selected ? NAVY : "#EDF1F6"} />
                        ) : opt.id === "cargo" ? (
                          <IconCargo size={18} fleck={selected ? NAVY : "#EDF1F6"} />
                        ) : (
                          <BrokerGlyph />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold text-[#1B3A5C] leading-[1.3]">
                          {opt.title}
                        </span>
                        <span className="block text-[11px] text-[#8B95A3] leading-[1.35] mt-px">
                          {opt.desc}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 w-[19px] h-[19px] rounded-full border-[1.5px] inline-flex items-center justify-center transition-colors duration-150 ${
                          selected ? "border-[#185FA5]" : "border-[#B6BFCC]"
                        }`}
                      >
                        <span
                          className={`w-[9px] h-[9px] rounded-full bg-[#185FA5] transition-transform duration-150 ${
                            selected ? "scale-100" : "scale-0"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="flex items-center gap-1.25 text-[11px] text-[#8B95A3] leading-[1.4] mt-1.25">
                <Info className="w-3.25 h-3.25 text-[#185FA5] shrink-0" />
                This sets up your workspace. You can add the other profile anytime.
              </p>
            </div>

            {/* Company segmented control */}
            <div className="mb-2.75">
              <span className={FIELD_LABEL}>
                Trading as a company?{" "}
                <span className="font-normal normal-case tracking-normal text-[#B6BFCC]">
                  (optional)
                </span>
              </span>
              <div className="grid grid-cols-3 rounded-[9px] border border-[#DDE2EA] overflow-hidden bg-white">
                {COMPANY_SEGMENTS.map(([value, label], i) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => form.setValue("companyMode", value, { shouldValidate: true })}
                    className={`px-1.5 py-2 text-[12.5px] font-medium leading-[1.3] transition-colors duration-150 cursor-pointer ${
                      i < COMPANY_SEGMENTS.length - 1 ? "border-r border-[#DDE2EA]" : ""
                    } ${
                      companyMode === value
                        ? "bg-[#1B3A5C] text-white"
                        : "bg-white text-[#4B5566] hover:bg-[#F5F7FA]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {companyMode !== "none" && (
                <div className="mt-1.5">
                  <input
                    type="text"
                    placeholder="Company name, e.g. Gulf Maritime LLC"
                    className={INPUT.replace("pl-9.5", "pl-3.5")}
                    {...form.register("companyName")}
                  />
                  {errors.companyName && (
                    <p className="text-[11px] text-red-500 mt-1">
                      {errors.companyName.message}
                    </p>
                  )}
                  <p className="text-[11px] text-[#8B95A3] leading-[1.4] mt-1">
                    {companyMode === "register"
                      ? "You'll be the company's admin and can approve teammates who join."
                      : "Your request goes to your company's admin for approval. Your seat activates once they confirm."}
                  </p>
                </div>
              )}
            </div>

            {/* Password + Confirm */}
            <div className="grid grid-cols-2 gap-3 mb-2.75 max-sm:grid-cols-1 max-sm:gap-2.75">
              <div>
                <label className={FIELD_LABEL} htmlFor="f-pass">
                  Password
                </label>
                <div className="relative">
                  <Lock className={INPUT_ICON} />
                  <input
                    id="f-pass"
                    type={showPassword ? "text" : "password"}
                    placeholder="8+ characters"
                    autoComplete="new-password"
                    className={`${INPUT} pr-10`}
                    {...form.register("password")}
                  />
                  <button
                    type="button"
                    aria-label="Show password"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md text-[#B6BFCC] hover:text-[#4B5566] hover:bg-[#F5F7FA]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-[11px] text-red-500 mt-1">{errors.password.message}</p>
                )}
              </div>
              <div>
                <label className={FIELD_LABEL} htmlFor="f-pass2">
                  Confirm password
                </label>
                <div className="relative">
                  <LockKeyhole className={INPUT_ICON} />
                  <input
                    id="f-pass2"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    className={`${INPUT} pr-10`}
                    {...form.register("confirmPassword")}
                  />
                  <button
                    type="button"
                    aria-label="Show password"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md text-[#B6BFCC] hover:text-[#4B5566] hover:bg-[#F5F7FA]"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-[11px] text-red-500 mt-1">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </div>

            {/* CTA — color tide + rolling wave crests + bob (Pre_Final §10) */}
            <button type="submit" disabled={isSubmitting} className="signup-cta">
              <span className="cta-label">
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Setting up your account…
                  </>
                ) : (
                  "Create account"
                )}
              </span>
              {!isSubmitting && <ArrowRight className="w-4 h-4 relative z-2" />}
              <span className="wave wave--back" />
              <span className="wave wave--mid" />
              <span className="wave wave--front" />
            </button>

            <p className="text-center text-[12.5px] text-[#8B95A3] mt-2.5">
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="text-[#185FA5] font-semibold hover:underline"
              >
                Sign in
              </Link>
            </p>

            <p className="text-center text-[10.5px] text-[#B6BFCC] leading-normal mt-2">
              By creating an account you agree to the{" "}
              <Link href="/terms" className="text-[#8B95A3] hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/legal" className="text-[#8B95A3] hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </form>
        </div>
      </div>

      {/* CTA wave animation, verbatim from Signup.html (reduced-motion safe) */}
      <style>{`
        .signup-cta {
          width: 100%;
          height: 44px;
          margin-top: 4px;
          position: relative;
          overflow: hidden;
          background: linear-gradient(115deg, #1B3A5C 0%, #185FA5 30%, #3FA0DC 50%, #185FA5 70%, #1B3A5C 100%);
          background-size: 280% 100%;
          animation: cta-tide 6s linear infinite;
          color: #fff;
          border: none;
          border-radius: 9px;
          font-family: inherit;
          font-size: 14.5px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform .15s ease, box-shadow .15s ease;
          box-shadow: 0 2px 8px rgba(13,34,64,0.22);
        }
        .signup-cta:disabled { cursor: default; opacity: 0.85; }
        .signup-cta:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(13,34,64,0.30);
          animation-duration: 3s;
        }
        .signup-cta .cta-label {
          position: relative;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        @keyframes cta-tide {
          0%   { background-position: 0% 50%; }
          100% { background-position: -280% 50%; }
        }
        .signup-cta .wave {
          position: absolute;
          left: 0;
          bottom: -4px;
          width: 200%;
          height: 30px;
          z-index: 1;
          background-repeat: repeat-x;
          background-size: 140px 30px;
          pointer-events: none;
          will-change: transform;
        }
        .signup-cta .wave--back {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='30' viewBox='0 0 140 30'%3E%3Cpath d='M0 16 Q 35 2 70 16 T 140 16 V 30 H 0 Z' fill='rgba(255,255,255,0.12)'/%3E%3C/svg%3E");
          animation: cta-wave 7s linear infinite, cta-bob 3.4s ease-in-out infinite;
        }
        .signup-cta .wave--mid {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='30' viewBox='0 0 140 30'%3E%3Cpath d='M0 19 Q 35 5 70 19 T 140 19 V 30 H 0 Z' fill='rgba(255,255,255,0.16)'/%3E%3C/svg%3E");
          animation: cta-wave 4.2s linear infinite, cta-bob 2.6s ease-in-out infinite 0.6s;
          background-position-x: 45px;
        }
        .signup-cta .wave--front {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='30' viewBox='0 0 140 30'%3E%3Cpath d='M0 22 Q 35 9 70 22 T 140 22 V 30 H 0 Z' fill='rgba(255,255,255,0.24)'/%3E%3C/svg%3E");
          animation: cta-wave 2.6s linear infinite, cta-bob 2s ease-in-out infinite 1.1s;
          background-position-x: 90px;
        }
        @keyframes cta-wave {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-140px); }
        }
        @keyframes cta-bob {
          0%, 100% { margin-bottom: 0; }
          50%      { margin-bottom: 3px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .signup-cta, .signup-cta .wave { animation: none; }
        }
      `}</style>
    </div>
  );
}

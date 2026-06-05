"use client";

import { useRef, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import {
  Ship,
  ArrowRight,
  BarChart3,
  Globe,
  Anchor,
  Waves,
  Navigation,
  Users,
  TrendingUp,
  Phone,
  FlaskConical,
  Sparkles,
  ShieldCheck,
  Clock,
  Lock,
} from "lucide-react";

import { ScrollZoomBackground } from "@/components/ScrollZoomBackground";
import { cn } from "@/lib/utils";


const features = [
  {
    icon: Ship,
    title: "Expert Dry-Bulk Brokerage",
    description:
      "Specialized brokerage for dry-bulk and break-bulk commodities. Every deal backed by hands-on shipboard experience and a deep MENA operator network.",
    accent: "from-ocean-400 to-ocean-600",
    iconBg:
      "bg-ocean-50 text-ocean-600 group-hover:bg-ocean-600 group-hover:text-white",
  },
  {
    icon: BarChart3,
    title: "Live Market Intelligence",
    description:
      "Real-time freight rate signals across the Red Sea, Arabian Gulf, and East Mediterranean — so you negotiate from a position of knowledge, not guesswork.",
    accent: "from-foam-400 to-foam-600",
    iconBg:
      "bg-foam-50 text-foam-600 group-hover:bg-foam-600 group-hover:text-white",
  },
  {
    icon: Globe,
    title: "MENA-Native Coverage",
    description:
      "14 trade zones. 120+ ports. Every major Red Sea and Arabian Gulf hub covered. Deep cultural and regulatory knowledge built from years in-market.",
    accent: "from-ocean-300 to-foam-500",
    iconBg:
      "bg-slate-50 text-slate-600 group-hover:bg-slate-700 group-hover:text-white",
  },
];

const steps = [
  {
    number: "01",
    title: "Submit Your Requirements",
    description:
      "Post your cargo or vessel availability in minutes. Our guided form ensures every matchmaking field is captured precisely.",
    icon: Navigation,
  },
  {
    number: "02",
    title: "Intelligent Matching",
    description:
      "Our engine cross-references zone, capacity, laycan, vessel type, and special requirements — filtering the entire register to surface only valid matches.",
    icon: Users,
  },
  {
    number: "03",
    title: "Close the Fixture",
    description:
      "We handle charter party negotiations and pre-hire inspections so your deal closes cleanly and profitably.",
    icon: TrendingUp,
  },
];

const trustSignals = [
  {
    icon: Lock,
    title: "Encrypted Contact Data",
    description:
      "All contact information is encrypted at the application layer. Broker A never sees Broker B's details.",
  },
  {
    icon: ShieldCheck,
    title: "Sanctions Screened",
    description:
      "Every vessel in the register is screened. Iranian-flagged and sanctioned vessels are permanently blocked from match results.",
  },
  {
    icon: Clock,
    title: "2-Hour Review SLA",
    description:
      "New submissions are reviewed by our team within 2 hours during business hours, keeping the market data clean and reliable.",
  },
];


function AnimatedStat({
  value,
  label,
  suffix,
  hint,
}: {
  value: string;
  label: string;
  suffix: string;
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const isNumeric = /^\d+$/.test(value);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView || !isNumeric) return;
    const target = parseInt(value, 10);
    // Reduced-motion: render the final count immediately, no animation.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setCount(target);
      return;
    }
    // Overshoot-and-settle: races up, peaks a few % past target around ~75%,
    // then eases back down and lands exactly on the real count.
    const DURATION = 1600;
    const easeOutBack = (p: number) => {
      const c1 = 2.2;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    };
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      if (p >= 1) {
        setCount(target); // final frame is exact, never the overshoot
        return;
      }
      setCount(Math.max(0, Math.round(target * easeOutBack(p))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isInView, isNumeric, value]);

  return (
    <div ref={ref} className="text-center flex flex-col items-center gap-1">
      <div className="text-4xl max-sm:text-3xl font-bold text-white tracking-tight tabular-nums">
        {isNumeric ? count : value}
        {suffix && <span className="text-foam-300 ml-0.5">{suffix}</span>}
      </div>
      <div className="text-[11px] text-ocean-300/70 font-bold tracking-widest uppercase">
        {label}
      </div>
      {hint && (
        <div className="text-[10px] text-ocean-400/70 font-medium normal-case tracking-normal">
          {hint}
        </div>
      )}
    </div>
  );
}

function EyebrowLabel({
  label,
  light = false,
}: {
  label: string;
  light?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-block text-[10px] font-bold tracking-[0.18em] uppercase mb-5 px-3.5 py-1.5 rounded-full border",
        light
          ? "bg-white/8 text-foam-300 border-white/10"
          : "bg-ocean-50 text-ocean-600 border-ocean-100",
      )}
    >
      {label}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  light = false,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  light?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
      viewport={{ once: true }}
      className="text-center mb-16 max-lg:mb-12 max-sm:mb-10"
    >
      <EyebrowLabel label={eyebrow} light={light} />
      <h2
        className={cn(
          "text-display-lg mb-5",
          light ? "text-white" : "text-ocean-950",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "text-[17px] max-sm:text-base max-w-2xl mx-auto leading-relaxed",
          light ? "text-ocean-100/70" : "text-slate-500",
        )}
      >
        {subtitle}
      </p>
    </motion.div>
  );
}

function LinkedinIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}


export interface HomeStats { cargoCount: number; vesselCount: number; zoneCount: number; }

export function HomeClient({ cargoCount, vesselCount, zoneCount }: HomeStats) {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  // Live hero stats (counts come from the server wrapper). The "+" on Cargo
  // Records is decorative; the animation lands on the exact DB number.
  const stats = [
    { value: String(cargoCount), label: "Cargo Records", suffix: "+", hint: "laycan within ±1 week" },
    { value: String(vesselCount), label: "Vessels Tracked", suffix: "" },
    { value: String(zoneCount), label: "Trade Zones", suffix: "" },
  ];

  return (
    <div className="flex flex-col w-full overflow-hidden bg-slate-50">
      <section
        ref={heroRef}
        className="relative min-h-[92vh] flex items-center justify-center pt-28 pb-36 max-lg:pt-24 max-lg:pb-28 max-sm:pt-20 max-sm:pb-20"
      >
        <ScrollZoomBackground image="/website-cover.jpeg" />

        <div className="absolute inset-0 z-1 pointer-events-none">
          <div className="absolute inset-0 bg-ocean-950/50" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(16,163,188,0.12) 0%, transparent 70%)",
            }}
          />
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-linear-to-t from-ocean-950/40 to-transparent" />
        </div>

        <motion.div
          style={{ opacity: heroOpacity, y: heroY }}
          className="relative z-10 container text-center"
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
            className="max-w-4xl mx-auto"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="inline-flex items-center gap-2.5 bg-white/10 backdrop-blur-md border border-white/15 rounded-full px-5 py-2 mb-8 shadow-lg"
            >
              <Anchor className="w-3.5 h-3.5 text-foam-400" />
              <span className="text-[12px] font-bold text-white/90 tracking-[0.12em] uppercase">
                MENA Dry-Bulk Brokerage Platform
              </span>
            </motion.div>

            <h1
              className="text-white mb-7 max-sm:mb-5"
              style={{
                fontSize: "clamp(2.4rem, 6vw, 4.75rem)",
                fontWeight: 800,
                letterSpacing: "-0.035em",
                lineHeight: 1.05,
              }}
            >
              The Matching Engine
              <br />
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(95deg, #6ed8e9 0%, #ffffff 55%, #9ae9f2 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                for MENA Shipping
              </span>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.55 }}
              className="text-[18px] max-sm:text-base text-ocean-100/80 mb-11 max-sm:mb-9 max-w-2xl mx-auto leading-relaxed"
            >
              Precision cargo-to-vessel matching across the Red Sea, Arabian
              Gulf, East Mediterranean, and Black Sea — with compliance,
              confidentiality, and speed built in.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.48, duration: 0.5 }}
              className="flex flex-row max-sm:flex-col gap-3.5 justify-center"
            >
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 h-13 px-8 text-[14.5px] font-bold bg-white text-ocean-950 hover:bg-slate-50 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.2)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_24px_rgba(0,0,0,0.25)] group"
              >
                Request Access
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/services"
                className="inline-flex items-center justify-center gap-2 h-13 px-8 text-[14.5px] font-bold bg-white/8 text-white border border-white/15 hover:bg-white/12 backdrop-blur-md rounded-xl transition-all hover:-translate-y-0.5 group"
              >
                Our Services
                <Ship className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      <section className="relative z-20 -mt-20 max-lg:-mt-16 max-sm:-mt-12">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.7 }}
            className="bg-ocean-950/85 backdrop-blur-2xl border border-white/8 shadow-2xl rounded-3xl p-10 max-lg:p-8 max-sm:p-6"
          >
            <div className="grid grid-cols-3 max-lg:grid-cols-2 gap-10 max-lg:gap-8 max-sm:gap-6">
              {stats.map((stat) => (
                <div key={stat.label} className="flex justify-center">
                  <AnimatedStat {...stat} />
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-32 max-lg:py-24 max-sm:py-18 bg-slate-50">
        <div className="container">
          <SectionHeader
            eyebrow="Why Arab ShipBroker"
            title="Built for the MENA Market"
            subtitle="We don't offer generic maritime services. Every feature — from zone-aware matching to sanctions screening — is purpose-built for the Red Sea and Arabian Gulf trade lanes."
          />

          <div className="grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-7 max-sm:gap-5">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.1,
                  ease: [0.2, 0, 0, 1],
                }}
                viewport={{ once: true }}
                className="group relative bg-white rounded-3xl p-9 max-sm:p-7 border border-slate-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_28px_rgba(45,109,168,0.1)] transition-all duration-400 hover:-translate-y-1"
              >
                <div
                  className={cn(
                    "absolute inset-x-10 top-0 h-0.5 rounded-b-full bg-linear-to-r opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                    feature.accent,
                  )}
                  aria-hidden
                />

                <div
                  className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center mb-7 transition-all duration-400",
                    feature.iconBg,
                  )}
                >
                  <feature.icon className="h-7 w-7 transition-colors duration-400" />
                </div>

                <h3 className="text-[19px] font-bold text-ocean-950 mb-3.5 tracking-tight leading-snug">
                  {feature.title}
                </h3>
                <p className="text-slate-500 text-[14.5px] leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-32 max-lg:py-24 max-sm:py-18 bg-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-125 h-125 bg-ocean-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none opacity-70" />
        <div className="absolute bottom-0 left-0 w-100 h-100 bg-foam-50 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none opacity-70" />

        <div className="container relative z-10">
          <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-24 max-lg:gap-14 max-sm:gap-10 items-center">
            <motion.div
              initial={{ opacity: 0, x: -24 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
              viewport={{ once: true }}
            >
              <EyebrowLabel label="About Us" />
              <h2 className="text-display-lg text-ocean-950 mb-7 max-sm:mb-5">
                Trusted Maritime{" "}
                <span className="text-ocean-500">Partners</span>
              </h2>
              <div className="space-y-5 text-[16px] max-sm:text-[15px] text-slate-500 leading-relaxed mb-9">
                <p>
                  Our boutique approach delivers personalized service without
                  sacrificing reach. We specialize in dry-bulk and break-bulk
                  commodities across the MENA region — from chartering to vessel
                  S&P.
                </p>
                <p>
                  Every fixture we close is underpinned by first-hand shipboard
                  knowledge, real-time market data, and relationships built over
                  years on the water and in trading offices from Egypt to the
                  UAE.
                </p>
              </div>
              <Link
                href="/services"
                className="inline-flex items-center gap-2 h-12.5 px-8 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold rounded-xl shadow-[0_2px_8px_rgba(45,109,168,0.25)] transition-all hover:-translate-y-0.5 group text-sm"
              >
                Explore Our Services
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="relative rounded-4xl overflow-hidden shadow-2xl border-8 border-white aspect-4/3 rotate-1 max-sm:rotate-0 hover:rotate-0 transition-transform duration-500">
                <Image
                  src="/home-image.jpeg"
                  alt="Maritime operations at a MENA port"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-linear-to-t from-ocean-950/75 via-ocean-950/15 to-transparent" />

                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.45 }}
                  viewport={{ once: true }}
                  className="absolute bottom-5 left-5 right-5 bg-white/10 backdrop-blur-2xl border border-white/15 rounded-2xl p-4 shadow-2xl"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-foam-500 rounded-xl flex items-center justify-center shrink-0">
                      <Waves className="w-6 h-6 text-ocean-950" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-base leading-tight tracking-tight">
                        Covering Major MENA Ports
                      </p>
                      <p className="text-xs text-ocean-100/70 font-medium mt-0.5">
                        Egypt · UAE · Saudi Arabia · Oman · Kuwait
                      </p>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-32 max-lg:py-24 max-sm:py-18 bg-ocean-950 relative overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-64 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(16,163,188,0.14) 0%, transparent 70%)",
          }}
          aria-hidden
        />

        <div className="container relative z-10">
          <SectionHeader
            eyebrow="Process"
            title="How It Works"
            subtitle="Three precise steps from requirement to fixture — no friction, no wasted time."
            light
          />

          <div className="relative max-w-4xl mx-auto mt-16">
            <div
              className="absolute top-11 left-[12%] right-[12%] h-px hidden lg:block pointer-events-none"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(16,163,188,0.25) 20%, rgba(16,163,188,0.25) 80%, transparent 100%)",
              }}
              aria-hidden
            />

            <div className="grid grid-cols-3 max-lg:grid-cols-1 gap-12 max-sm:gap-10 relative z-10">
              {steps.map((step, index) => (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.12,
                    ease: [0.2, 0, 0, 1],
                  }}
                  viewport={{ once: true }}
                  className="flex flex-col items-center text-center group"
                >
                  <div className="relative mb-7">
                    <div className="absolute inset-0 bg-foam-500/15 rounded-2xl blur-xl group-hover:bg-foam-400/25 transition-colors duration-500" />
                    <div className="relative w-22 h-22 max-sm:w-20 max-sm:h-20 bg-ocean-900 border border-ocean-700/80 rounded-2xl flex items-center justify-center shadow-2xl group-hover:border-foam-500/40 group-hover:-translate-y-2 transition-all duration-400 z-10">
                      <step.icon className="w-9 h-9 max-sm:w-8 max-sm:h-8 text-foam-400 group-hover:text-foam-300 transition-colors" />
                    </div>
                    <div className="absolute -top-3 -right-3 w-7 h-7 bg-foam-500 text-ocean-950 font-bold rounded-full flex items-center justify-center text-xs shadow-lg z-20">
                      {step.number}
                    </div>
                  </div>

                  <h3 className="text-[17px] font-bold text-white mb-3.5 tracking-tight leading-snug group-hover:text-foam-100 transition-colors">
                    {step.title}
                  </h3>
                  <p className="text-[14px] text-ocean-200/65 leading-relaxed px-2">
                    {step.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-28 max-lg:py-20 bg-slate-50">
        <div className="container">
          <SectionHeader
            eyebrow="Platform Standards"
            title="Compliance Built In"
            subtitle="This is not a simple marketplace. Every rule in our platform exists because shipping across MENA demands it."
          />

          <div className="grid grid-cols-3 max-lg:grid-cols-1 gap-6 max-w-5xl mx-auto">
            {trustSignals.map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: index * 0.08 }}
                viewport={{ once: true }}
                className="bg-white rounded-2xl p-7 border border-slate-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
              >
                <div className="w-11 h-11 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center mb-5">
                  <item.icon className="w-5 h-5 text-ocean-600" />
                </div>
                <h3 className="text-[15px] font-bold text-ocean-950 mb-2.5 tracking-tight">
                  {item.title}
                </h3>
                <p className="text-[13.5px] text-slate-500 leading-relaxed">
                  {item.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-28 max-lg:py-20 bg-slate-50 relative overflow-hidden">
        <div className="container relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <div className="relative bg-ocean-950 rounded-4xl p-16 max-lg:p-12 max-sm:p-8 overflow-hidden shadow-2xl">
              <div className="absolute -top-32 -right-32 w-80 h-80 bg-foam-500/15 rounded-full blur-[80px] pointer-events-none" />
              <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-ocean-600/15 rounded-full blur-[80px] pointer-events-none" />

              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="inline-flex items-center gap-2 bg-foam-500/10 border border-foam-500/20 rounded-full px-4 py-1.5 mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foam-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-foam-400" />
                  </span>
                  <span className="text-[11px] font-bold tracking-[0.16em] uppercase text-foam-300">
                    Now in Beta
                  </span>
                </div>

                <div className="w-16 h-16 bg-linear-to-br from-ocean-800 to-ocean-900 border border-ocean-700/50 rounded-2xl flex items-center justify-center mb-7 shadow-xl">
                  <FlaskConical className="w-8 h-8 text-foam-400" />
                </div>

                <h2
                  className="text-white mb-5"
                  style={{
                    fontSize: "clamp(1.75rem, 4vw, 2.8rem)",
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.1,
                  }}
                >
                  Cargo & Vessel Matching is{" "}
                  <span
                    style={{
                      backgroundImage:
                        "linear-gradient(95deg, #6ed8e9, #26c0d5)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    Live
                  </span>
                </h2>

                <p className="text-ocean-100/70 text-[17px] max-sm:text-base mb-7 max-w-xl leading-relaxed">
                  Our matching engine is cross-referencing zones, capacities,
                  laycans, and vessel requirements in real time. Early adopters
                  get priority access and direct input into platform direction.
                </p>

                <p className="text-foam-400/70 text-sm font-medium mb-9 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Priority access for early adopters
                </p>

                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 h-13 px-10 max-sm:w-full max-sm:justify-center bg-foam-500 hover:bg-foam-600 text-ocean-950 font-bold rounded-xl shadow-[0_2px_12px_rgba(16,163,188,0.3)] transition-all hover:-translate-y-0.5 group text-[15px]"
                >
                  Request Early Access
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-28 max-lg:py-20 bg-white">
        <div className="container">
          <SectionHeader
            eyebrow="Leadership"
            title="Meet the Founder"
            subtitle="Forged on ship steel, driven by the scent of cargo, dedicated to connecting MENA maritime markets."
          />

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <div className="bg-slate-50 rounded-4xl border border-slate-200/70 overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
              <div className="h-1 bg-linear-to-r from-ocean-600 via-foam-400 to-ocean-600" />

              <div className="p-14 max-lg:p-10 max-sm:p-8 flex flex-row max-lg:flex-col items-center max-lg:items-start max-sm:items-center gap-12 max-sm:gap-8">
                <div className="shrink-0 relative">
                  <div className="w-36 h-36 max-sm:w-28 max-sm:h-28 rounded-2xl overflow-hidden shadow-2xl border-4 border-white rotate-1 max-sm:rotate-0 hover:rotate-0 transition-transform duration-400">
                    <Image
                      src="/cp.jpeg"
                      alt="Capt. Mohamed Dawoud"
                      width={144}
                      height={144}
                      className="object-cover"
                    />
                  </div>
                  <div className="absolute -bottom-3 -right-3 w-10 h-10 bg-ocean-600 rounded-xl flex items-center justify-center shadow-lg border-4 border-white">
                    <Anchor className="w-4 h-4 text-white" />
                  </div>
                </div>

                <div className="flex-1 text-left max-lg:text-left max-sm:text-center">
                  <h3 className="text-2xl font-bold text-ocean-950 tracking-tight mb-1">
                    Mohamed Dawoud
                  </h3>
                  <p className="text-ocean-600 font-bold tracking-wide uppercase text-[11px] mb-1 leading-none">
                    Dry Bulk Broker &amp; Co-Founder
                  </p>
                  <p className="text-slate-400 text-[12px] font-medium mb-5">
                    Capt., BSc., MSc. &ldquo;Fleet Ops.&rdquo;
                  </p>
                  <div className="w-12 h-0.5 bg-foam-300 rounded-full mb-6 max-sm:mx-auto" />
                  <p className="text-slate-500 text-[15px] leading-relaxed mb-7">
                    His feet first stepped on ship steel years ago, and he still
                    carries the scent of the cargo with him today. With an MSc.
                    in Fleet Operations, a Master Mariner License, and over 10
                    years of extensive shipboard experience on bulk carriers,
                    Capt. Mohamed brings academic rigor and practical maritime
                    knowledge to every deal.
                  </p>
                  <a
                    href="https://www.linkedin.com/in/cpt-mohamed-dawoud"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 h-10 px-6 text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-ocean-50 hover:text-ocean-700 hover:border-ocean-200 rounded-xl transition-all"
                  >
                    <LinkedinIcon className="w-4 h-4 text-ocean-600" />
                    Connect on LinkedIn
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-28 max-lg:py-20 bg-ocean-950 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 50% 100%, rgba(16,163,188,0.12) 0%, transparent 65%)",
          }}
          aria-hidden
        />
        <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-foam-500/15 to-transparent" />

        <div className="container relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto"
          >
            <h2
              className="text-white mb-6"
              style={{
                fontSize: "clamp(2rem, 5vw, 3.5rem)",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
              }}
            >
              Ready to Navigate <br />
              <span className="text-foam-300">MENA Shipping?</span>
            </h2>
            <p className="text-ocean-200/65 text-[17px] max-sm:text-base mb-10 leading-relaxed">
              Whether you need to charter a vessel, move cargo, or explore the
              market — our expert team is ready.
            </p>
            <div className="flex flex-row max-sm:flex-col gap-4 justify-center">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 h-13 px-9 text-[14.5px] font-bold bg-white text-ocean-950 hover:bg-slate-50 rounded-xl shadow-[0_2px_16px_rgba(255,255,255,0.08)] transition-all hover:-translate-y-0.5"
              >
                <Phone className="w-4 h-4" />
                Contact Us Today
              </Link>
              <Link
                href="/services"
                className="inline-flex items-center justify-center gap-2 h-13 px-9 text-[14.5px] font-bold bg-white/6 text-white border border-white/12 hover:bg-white/10 backdrop-blur-md rounded-xl transition-all hover:-translate-y-0.5 group"
              >
                View Services
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

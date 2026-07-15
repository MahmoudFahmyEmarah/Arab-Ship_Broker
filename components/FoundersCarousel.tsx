"use client";

// Shared 3D founders carousel — used on both the home page and the contact
// page so the card, transition, and auto-advance animation stay identical.
// Extracted verbatim from home-client.tsx.

import { useState, useEffect, useRef } from "react";
import Image from "next/image";

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

export interface Founder {
  name: string;
  role: string;
  creds: string;
  bio: string;
  img: string | null;
  imgPos: string;
  initials: string;
  linkedin: string;
}

export const founders: Founder[] = [
  {
    name: "Mohamed Dawoud",
    role: "Dry Bulk Broker & Co-Founder",
    creds: "Capt., BSc., MSc. “Fleet Ops.”",
    bio: "His career began on ship steel, and the discipline of cargo operations continues to shape his work today. With an MSc in Fleet Operations, a Master Mariner Licence, and more than 10 years aboard bulk carriers, Capt. Mohamed combines hands-on maritime knowledge with strong commercial judgment. He supports owners and charterers with practical market insight, risk-aware negotiations, and reliable execution across dry-bulk transactions.",
    img: "/founder.jpg",
    imgPos: "60% 30%",
    initials: "MD",
    linkedin: "https://www.linkedin.com/in/cpt-mohamed-dawoud",
  },
  {
    name: "Ahmed Abdallah",
    role: "Dry Bulk Broker & Co-Founder",
    creds: "C/O, Master Mariner, MSc. “Maritime Nav.”",
    bio: "From the bridge to the brokerage desk, Ahmed combines years at sea with a strong understanding of dry-bulk markets. Having sailed as Chief Officer across international fleets, he brings practical operational insight to S&P and dry-bulk brokerage. Ahmed supports owners in evaluating opportunities, negotiating commercial terms, and executing transactions across the Red Sea, Arabian Gulf, and Arabian Sea.",
    img: "/cofounder.jpg",
    imgPos: "center 20%",
    initials: "AA",
    linkedin: "https://www.linkedin.com/in/ahmed-abdallah-8a26441a9/",
  },
  {
    name: "Mahmoud Emarah",
    role: "Chief Technology Officer & Co-Founder",
    creds: "MSc. “Data Science”, RWTH Aachen University",
    bio: "Mahmoud leads Arab ShipBroker's technology strategy, digital product development, and AI-driven transformation. His experience spans software engineering, data science, and enterprise AI platforms across international organizations including Vodafone and Saudi Telecom Company (STC), where he led large-scale AI ecosystems and award-winning innovation initiatives. At Arab ShipBroker, he builds the secure, data-driven platforms that modernize maritime brokerage and speed commercial decision-making across the MENA shipping market.",
    img: "/cto.jpeg",
    imgPos: "center 25%",
    initials: "ME",
    linkedin: "https://www.linkedin.com/in/mahmoud-emarah/",
  },
];

function FounderCard({
  p,
  cardRef,
}: {
  p: Founder;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={cardRef}
      className="w-full bg-slate-50 rounded-4xl border border-slate-200/70 overflow-hidden shadow-[0_18px_45px_rgba(10,26,47,0.10)] flex flex-col"
    >
      <div className="h-1 bg-linear-to-r from-ocean-600 via-foam-400 to-ocean-600" />

      <div className="p-10 max-sm:p-8 flex flex-col gap-6 flex-1">
        <div className="flex items-center gap-5 max-sm:flex-col max-sm:items-center max-sm:text-center">
          <div className="shrink-0">
            <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-2xl border-4 border-white bg-linear-to-br from-ocean-600 to-ocean-800 flex items-center justify-center">
              {p.img ? (
                <Image
                  src={p.img}
                  alt={p.name}
                  width={288}
                  height={288}
                  quality={92}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: p.imgPos }}
                />
              ) : (
                <span className="text-white text-2xl font-bold tracking-tight">{p.initials}</span>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold text-ocean-950 tracking-tight mb-1">{p.name}</h3>
            <p className="text-ocean-600 font-bold tracking-wide uppercase text-[11px] mb-1 leading-none">{p.role}</p>
            <p className="text-slate-400 text-[12px] font-medium">{p.creds}</p>
          </div>
        </div>

        <div className="w-12 h-0.5 bg-foam-300 rounded-full max-sm:mx-auto" />
        <p className="text-slate-500 text-[15px] leading-relaxed flex-1">{p.bio}</p>

        <a
          href={p.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-2.5 h-10 px-6 text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-ocean-50 hover:text-ocean-700 hover:border-ocean-200 rounded-xl transition-all self-start max-sm:self-center"
        >
          <LinkedinIcon className="w-4 h-4 text-ocean-600" />
          Connect on LinkedIn
        </a>
      </div>
    </div>
  );
}

export function FoundersCarousel() {
  const n = founders.length;
  const INTERVAL = 5; // seconds per card
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [stageHeight, setStageHeight] = useState(560);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pausedRef = useRef(false);
  const progressRef = useRef(0);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // A single rAF loop drives BOTH the progress bar and the auto-advance from the
  // same elapsed-time source, so they can never drift apart. The bar width is
  // updated imperatively (no per-frame re-renders); when it reaches 100% the
  // carousel advances. Pausing just stops accumulating time.
  useEffect(() => {
    if (reduceMotion) {
      if (fillRef.current) fillRef.current.style.width = "100%";
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current) {
        progressRef.current += dt / (INTERVAL * 1000);
        if (progressRef.current >= 1) {
          progressRef.current = 0;
          setActive((a) => (a + 1) % n);
        }
        if (fillRef.current) {
          fillRef.current.style.width = `${Math.min(100, progressRef.current * 100)}%`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, n]);

  // Jump straight to a card (click / keyboard) and reset the timer + bar.
  const goTo = (i: number) => {
    progressRef.current = 0;
    if (fillRef.current) fillRef.current.style.width = "0%";
    setActive(i);
  };

  // Absolutely-positioned cards leave the flow, so the stage needs an explicit
  // height. Track the tallest card (transforms don't affect offsetHeight) and
  // re-measure on resize so the layout stays correct across breakpoints.
  useEffect(() => {
    const measure = () => {
      let max = 0;
      for (const el of cardRefs.current) if (el) max = Math.max(max, el.offsetHeight);
      if (max) setStageHeight(max);
    };
    measure();
    const t = setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="relative mx-auto"
        style={{ maxWidth: 1280, height: stageHeight, perspective: 1600 }}
      >
        {founders.map((p, i) => {
          let offset = (i - active + n) % n;
          if (offset === 2) offset = -1;
          const isCenter = offset === 0;
          const x = offset * 46;
          const scale = isCenter ? 1 : 0.82;
          const rotY = offset * -28;
          const z = isCenter ? 0 : -160;
          return (
            <div
              key={p.name}
              onClick={isCenter ? undefined : () => goTo(i)}
              onKeyDown={
                isCenter
                  ? undefined
                  : (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goTo(i);
                      }
                    }
              }
              role={isCenter ? undefined : "button"}
              tabIndex={isCenter ? undefined : 0}
              aria-label={isCenter ? undefined : `Show ${p.name}`}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 600,
                maxWidth: "88vw",
                transform: `translate(-50%, -50%) translateX(${x}%) translateZ(${z}px) rotateY(${rotY}deg) scale(${scale})`,
                transformStyle: "preserve-3d",
                backfaceVisibility: "hidden",
                zIndex: isCenter ? 3 : 1,
                opacity: isCenter ? 1 : 0.45,
                filter: isCenter ? "none" : "saturate(0.75)",
                cursor: isCenter ? "default" : "pointer",
                transition: reduceMotion
                  ? "none"
                  : "transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.7s ease, filter 0.7s ease",
                willChange: "transform",
              }}
            >
              <FounderCard
                p={p}
                cardRef={(el) => {
                  cardRefs.current[i] = el;
                }}
              />
            </div>
          );
        })}

        <div className="absolute left-1/2 -translate-x-1/2 -bottom-9 w-45 h-[3px] rounded-full bg-slate-200 overflow-hidden">
          <div
            ref={fillRef}
            className="h-full bg-ocean-600 rounded-full"
            style={{ width: "0%", opacity: paused ? 0.35 : 1 }}
          />
        </div>
      </div>

      <p className="text-center mt-16 max-sm:mt-14 text-[13.5px] text-slate-400">
        Hover a card to pause — click a side card to bring it forward
      </p>
    </div>
  );
}

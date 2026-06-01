"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Info,
  Database,
  BarChart3,
  Share2,
  Lock,
  Trash2,
  UserCheck,
  Scale,
  Mail,
  Anchor,
  Users,
  ChevronRight,
} from "lucide-react";

import { cn } from "@/lib/utils";

const sections = [
  {
    id: "legal-disclaimer",
    icon: <Info className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "1. Legal & Branding Disclaimer",
    content: (
      <div className="space-y-5 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <p>
          <strong className="text-ocean-900 font-semibold">
            Arab ShipBroker
          </strong>{" "}
          is the commercial name and professional brand under which our
          shipbroking and market-intelligence activities are conducted.
        </p>
        <p>
          The use of the term Arab ShipBroker does not automatically imply the
          existence of, or reference to, a single incorporated legal entity in
          every jurisdiction. While formal legal entities are being established
          in Egypt and/or the United Arab Emirates, the brand Arab ShipBroker
          may also represent the work of individual professional shipbrokers and
          independent practitioners operating under the same brand identity.
        </p>
        <div className="bg-ocean-50/50 border-l-4 border-ocean-500 p-6 max-[768px]:p-5 rounded-r-2xl mt-6">
          <p className="text-base font-bold text-ocean-900 mb-3 tracking-tight">
            Notice of Responsibility:
          </p>
          <ul className="text-base max-[768px]:text-sm text-ocean-800 list-disc pl-5 space-y-2">
            <li>
              Arab ShipBroker refers to the brand, not a registered trademark or
              incorporated entity.
            </li>
            <li>
              All responsibilities and activities under this brand are overseen
              and coordinated by{" "}
              <strong className="font-semibold">Mohamed Dawoud & Co</strong>,
              who is the person legally and operationally in charge of the brand
              and its business conduct.
            </li>
            <li>
              Any references to “the Company,” “Arab ShipBroker,” or “we” should
              be interpreted within this context unless a formal contract
              specifies otherwise.
            </li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "purpose-collection",
    icon: <Database className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "2. Purpose of Data Collection",
    content: (
      <div className="space-y-6 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <p>
          Arab ShipBroker collects operational, technical, and commercial
          information strictly for business placement and brokerage activities.
        </p>
        <div className="grid grid-cols-2 max-[1024px]:grid-cols-1 gap-6 max-[768px]:gap-4 mt-4">
          <div className="p-6 max-[768px]:p-5 bg-slate-50 rounded-2xl border border-slate-200/60 flex flex-col gap-3 hover:border-ocean-200 transition-colors">
            <div className="w-10 h-10 bg-ocean-100 rounded-xl flex items-center justify-center text-ocean-600 mb-1">
              <Anchor className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-ocean-900 text-base mb-1">
                Vessel Matching
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Matching vessels with suitable cargoes and evaluating commercial
                feasibility.
              </p>
            </div>
          </div>
          <div className="p-6 max-[768px]:p-5 bg-slate-50 rounded-2xl border border-slate-200/60 flex flex-col gap-3 hover:border-ocean-200 transition-colors">
            <div className="w-10 h-10 bg-ocean-100 rounded-xl flex items-center justify-center text-ocean-600 mb-1">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-ocean-900 text-base mb-1">
                Market Placement
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Presenting business opportunities (cargo or vessel) to relevant
                market participants.
              </p>
            </div>
          </div>
        </div>
        <p className="text-base max-[768px]:text-sm text-slate-500 italic bg-slate-50 p-4 rounded-xl border border-slate-100">
          You grant Arab ShipBroker the right to use the data you provide for
          commercial brokerage and business placement exclusively, unless you
          instruct otherwise in writing.
        </p>
      </div>
    ),
  },
  {
    id: "research-intelligence",
    icon: <BarChart3 className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "3. Research & Market Intelligence",
    content: (
      <div className="space-y-5 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <p>
          You acknowledge that Arab ShipBroker operates a legitimate Market
          Intelligence and Research Unit. By providing your data, you grant us
          the right to use such information for research, analysis, and
          statistical models.
        </p>
        <div className="mt-6">
          <p className="font-semibold text-ocean-900 mb-3">
            This use is strictly subject to the following conditions:
          </p>
          <ul className="list-disc pl-5 space-y-3 text-slate-600 marker:text-ocean-400">
            <li>
              Any published or shared output will be{" "}
              <strong className="font-semibold text-ocean-900">
                anonymized
              </strong>
              .
            </li>
            <li>
              No commercially sensitive or identifying information will be
              disclosed without your explicit permission.
            </li>
            <li>
              The purpose remains limited to understanding, explaining, or
              improving dry-bulk market dynamics.
            </li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "data-sharing",
    icon: <Share2 className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "4. Controlled Sharing of Data",
    content: (
      <div className="space-y-8 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <div>
          <h4 className="font-bold text-ocean-900 text-xl max-[768px]:text-lg mb-3 flex items-center gap-2">
            <span className="text-ocean-400 text-sm">4.1</span>{" "}
            Operational/Commercial Sharing
          </h4>
          <p className="pl-8 max-[1024px]:pl-0">
            Data may be shared with third parties strictly within the scope of
            securing a charter, matching cargo with vessel, evaluating freight
            terms, or performing fixture operations.
          </p>
        </div>
        <div>
          <h4 className="font-bold text-ocean-900 text-xl max-[768px]:text-lg mb-3 flex items-center gap-2">
            <span className="text-ocean-400 text-sm">4.2</span> Sharing Beyond
            Scope
          </h4>
          <p className="pl-8 max-[1024px]:pl-0">
            If Arab ShipBroker wishes to share your information for any purpose
            outside the operational scope—such as investor presentations,
            academic publications with identifying details, or commercial
            partnerships—we will seek your{" "}
            <strong className="font-semibold text-ocean-900">
              prior written consent
            </strong>
            .
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "confidentiality-protection",
    icon: <Lock className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "5. Confidentiality & Data Protection",
    content: (
      <div className="space-y-6 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <p>
          Arab ShipBroker commits to implementing industry-accepted safeguards
          to ensure your information is:
        </p>
        <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4 mt-4">
          {[
            "Stored securely",
            "Accessed only by authorized personnel",
            "Not shared with non-related parties",
            "Not sold or licensed without permission",
          ].map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Shield className="w-5 h-5 text-foam-500 shrink-0 mt-0.5" />
              <span className="text-base text-slate-700 font-medium">
                {item}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "retention-minimization",
    icon: <Trash2 className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "6. Data Minimization & Retention",
    content: (
      <div className="space-y-4 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <p>
          We will only collect information that is genuinely required for
          brokerage and market analysis. Data will be retained only as long as
          necessary, or as required by applicable regulations.
        </p>
      </div>
    ),
  },
  {
    id: "user-rights",
    icon: <UserCheck className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "7. Your Rights",
    content: (
      <div className="space-y-5 text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul className="space-y-3 bg-slate-50 p-6 rounded-2xl border border-slate-100">
          {[
            "Request a copy of the data we hold",
            "Request correction of inaccurate data",
            "Request deletion of certain data",
            "Withdraw consent for non-essential processing",
          ].map((right, i) => (
            <li key={i} className="flex items-center gap-3 text-slate-700">
              <div className="w-1.5 h-1.5 rounded-full bg-ocean-400 shrink-0" />
              {right}
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "framework-jurisdiction",
    icon: <Scale className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "8. Legal Framework & Jurisdiction",
    content: (
      <p className="text-lg max-[768px]:text-base text-slate-600 leading-relaxed">
        This policy considers the principles of regional data protection
        requirements in MENA, international maritime practice, and general
        privacy standards within the commercial norms of shipbroking and
        chartering.
      </p>
    ),
  },
  {
    id: "contact-compliance",
    icon: <Mail className="w-6 h-6 max-[768px]:w-5 max-[768px]:h-5" />,
    title: "9. Contact & Compliance",
    content: (
      <div className="bg-ocean-950 text-white rounded-3xl p-12 max-[1024px]:p-10 max-[768px]:p-8 flex flex-col items-center text-center justify-center gap-8 relative overflow-hidden mt-4 shadow-xl shadow-ocean-900/10">
        <div className="absolute top-0 right-0 w-64 h-64 bg-foam-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-ocean-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10 flex flex-col items-center max-w-lg">
          <div className="w-14 h-14 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center mb-5 backdrop-blur-sm">
            <Shield className="w-7 h-7 text-foam-300" />
          </div>

          <h4 className="font-bold text-3xl max-[768px]:text-2xl mb-3 tracking-tight text-white">
            Compliance Department
          </h4>
          <p className="text-ocean-200 text-lg max-[768px]:text-base">
            For questions regarding data use, retention, or confidentiality
            matters.
          </p>
        </div>

        <a
          href="mailto:compliance@arabshipbroker.com"
          className="relative z-10 bg-white text-ocean-950 px-8 py-4 rounded-xl font-bold hover:bg-ocean-50 hover:-translate-y-1 transition-all flex items-center justify-center gap-3 shadow-lg group whitespace-nowrap w-auto max-[768px]:w-full"
        >
          <Mail className="w-5 h-5 text-ocean-600" />
          compliance@arabshipbroker.com
          <ChevronRight className="w-4 h-4 text-ocean-400 group-hover:translate-x-1 transition-transform" />
        </a>
      </div>
    ),
  },
];

export default function LegalPage() {
  const [activeSection, setActiveSection] =
    useState<string>("legal-disclaimer");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );

    sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col w-full min-h-screen bg-slate-50">
      <section className="relative pt-40 pb-32 max-[1024px]:pt-32 max-[1024px]:pb-24 max-[768px]:pt-24 max-[768px]:pb-20 bg-ocean-950 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(43,185,211,0.15),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay pointer-events-none" />

        <div className="container relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-4xl mx-auto"
          >
            <span className="inline-block text-xs font-bold tracking-widest uppercase mb-6 px-4 py-1.5 rounded-full bg-white/10 text-foam-300 border border-white/10 backdrop-blur-md">
              Data & Confidentiality
            </span>
            <h1 className="text-6xl max-[1024px]:text-5xl max-[768px]:text-4xl font-bold text-white mb-6 leading-tight tracking-tight drop-shadow-lg">
              Legal Notes <span className="text-foam-300">& Policy</span>
            </h1>
            <p className="text-xl max-[768px]:text-lg text-ocean-100/90 leading-relaxed max-w-2xl mx-auto drop-shadow">
              Our policy on data use, confidentiality, and protection for the
              maritime community.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-24 max-[768px]:py-16 relative z-20">
        <div className="container">
          <div className="grid grid-cols-12 max-[1024px]:grid-cols-1 gap-16 max-[768px]:gap-10 items-start">
            <aside className="block max-[1024px]:hidden col-span-4 sticky top-32">
              <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/40 border border-slate-200/60 p-8">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
                  On This Page
                </h3>
                <nav className="flex flex-col space-y-2">
                  {sections.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className={cn(
                        "group flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 text-sm font-medium",
                        activeSection === section.id
                          ? "bg-ocean-50 text-ocean-700 shadow-sm ring-1 ring-ocean-100/50"
                          : "text-slate-500 hover:text-ocean-600 hover:bg-slate-50",
                      )}
                    >
                      <span
                        className={cn(
                          "transition-colors duration-300",
                          activeSection === section.id
                            ? "text-ocean-600"
                            : "text-slate-400 group-hover:text-ocean-500",
                        )}
                      >
                        {section.icon}
                      </span>
                      <span className="truncate">
                        {section.title.split(". ")[1]}
                      </span>
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            <div className="col-span-8 max-[1024px]:col-span-1 space-y-12 max-[768px]:space-y-8">
              {sections.map((section, index) => (
                <motion.div
                  key={section.id}
                  id={section.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    delay: Math.min(index * 0.1, 0.3),
                  }}
                  viewport={{ once: true, margin: "-100px" }}
                  className="bg-white rounded-3xl p-12 max-[1024px]:p-10 max-[768px]:p-8 border border-slate-200/60 shadow-lg shadow-slate-200/40 hover:shadow-xl hover:shadow-ocean-500/5 transition-shadow duration-500 scroll-mt-32"
                >
                  <div className="flex items-center gap-5 mb-8 border-b border-slate-100 pb-6">
                    <div className="w-14 h-14 bg-ocean-50 text-ocean-600 rounded-2xl flex items-center justify-center shrink-0 shadow-inner">
                      {section.icon}
                    </div>
                    <h2 className="text-3xl max-[768px]:text-2xl font-bold text-ocean-900 tracking-tight">
                      {section.title}
                    </h2>
                  </div>
                  <div className="text-slate-600">{section.content}</div>
                </motion.div>
              ))}

              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                className="pt-8 border-t border-slate-200/60 text-center"
              >
                <div className="flex flex-col items-center gap-4 text-slate-400">
                  <Anchor className="w-8 h-8 opacity-20" />
                  <p className="text-sm font-medium tracking-wide">
                    Arab ShipBroker Data Use, Confidentiality & Protection
                    Policy
                  </p>
                  <p className="text-xs uppercase tracking-widest font-semibold text-slate-300">
                    Last Updated: November 18, 2025
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

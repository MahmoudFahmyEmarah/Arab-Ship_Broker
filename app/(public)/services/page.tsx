"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Ship,
  FileSearch,
  TrendingUp,
  Package,
  Anchor,
  Globe,
  ChevronDown,
  ArrowRight,
  Phone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const services = [
  {
    icon: Ship,
    title: "Dry-Bulk Brokerage",
    description:
      "Comprehensive brokerage services for dry-bulk commodities including grains, coal, iron ore, and fertilizers with competitive rates and reliable execution.",
  },
  {
    icon: Package,
    title: "Break-Bulk Brokerage",
    description:
      "Specialized handling break-bulk cargo including steel products, machinery, and project cargo with expert vessel selection coordination.",
  },
  {
    icon: Anchor,
    title: "S&P Services (<30K DWT)",
    description:
      "Vessel sales and purchase advisory for smaller tonnage vessels with comprehensive market analysis and transaction support.",
  },
  {
    icon: FileSearch,
    title: "Pre-Hire Inspections",
    description:
      "Thorough vessel inspections before fixture to ensure compliance, safety, and operational readiness with detailed reporting.",
  },
  {
    icon: TrendingUp,
    title: "Market Analysis - still under progress",
    description:
      "Real-time market intelligence, freight rate analysis, and strategic advisory services to optimize your shipping decisions.",
  },
  {
    icon: Globe,
    title: "MENA Expertise",
    description:
      "Deep regional knowledge of Middle East and North African markets, regulations, and business practice, backed by connections and ability to read in-between lines",
  },
];

const faqs = [
  {
    question: "What types of cargo do you specialize in?",
    answer:
      "We specialize in dry-bulk commodities including grains, coal, iron ore, fertilizers, and break-bulk cargo such as steel products, machinery, and project cargo. Our expertise covers the full spectrum of non-containerized cargo commonly traded in the MENA region.",
  },
  {
    question: "What is your coverage area?",
    answer:
      "While we specialize in the MENA region, our network extends globally. We handle shipments originating from or destined to the Middle East and North Africa, with particular expertise in regional ports, regulations, and market conditions.",
  },
  {
    question: "How do you determine charter/hire rates?",
    answer:
      "For smaller tonnage segments (Handy, Coaster, and sub-30k vessels), charter rates do not follow a single index like Supramax or Panamax. Instead, rates are determined through peer fixing and a detailed assessment of each shipment’s unique parameters: specific cargo characteristics, port restrictions, laycan, and operational complexities. We help decision-makers evaluate all these factors in real time, combining market intelligence with practical experience to arrive at fair and competitive rates.",
  },
  {
    question: "What is your edge?",
    answer:
      "We've been where it matters—onboard ships, touching cargo, seeing ports with our own eyes, not just through documents. Having worked across every tier of the maritime industry, we know the difference between genuine value and inflated costs. We help you avoid paying premium prices for standard services, delivering the same result for significantly less.",
  },
  {
    question: "What principles are you committed to?",
    answer: `We operate under a strict code of ethics rooted in Islamic Sharia-compliant principles for all brokerage (Wasata & Samsara) activities. Our commitment to our clients is built on three core pillars:
1. Integrity and Transparency: We honor our word as a binding contract. Every transaction is conducted with full disclosure to ensure all parties are treated fairly and without ambiguity.
2. Financial Guarantee of Services: We stand behind the quality and execution of our brokerage services with a formal financial guarantee, providing our clients with peace of mind in a volatile market.
3. Accountability for Omissions: We take full responsibility for our actions. We are committed to covering any financial losses or damages that arise genuinely from our own errors or omissions.
• Note: This commitment applies to our direct brokerage performance and does not extend to defaults or liabilities caused by third parties (e.g., ship owners or port authorities).`,
  },
  {
    question: "What support do you provide for first-time shippers?",
    answer: `We focus on what we do best: vessel selection and all related maritime documentation.

A full first-time shipment involves a much larger cycle, including:
• Contract of sale and terms of trade (Incoterms)
• Pre-cargo inspection and survey arrangements
• Inland transportation to the load port
• Customs clearance and export/import formalities
• Cargo insurance and risk coverage
• Payment methods and trade finance (LC, TT, etc.)

We do not claim to handle all of these deeply — and we never overpromise. However, we remain at the intersection where all these circles meet. We help you navigate the shipping leg with confidence and, where needed, guide you to the right partners for the rest — because a smooth voyage starts with the right vessel and the right advice.`,
  },
];

export default function ServicesPage() {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenFaqIndex((prev) => (prev === index ? null : index));
  };

  return (
    <div className="flex flex-col w-full overflow-hidden bg-slate-50">
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
              Our Expertise
            </span>
            <h1 className="text-6xl max-[1024px]:text-5xl max-[768px]:text-4xl font-bold text-white mb-6 leading-tight tracking-tight drop-shadow-lg">
              Comprehensive <br />
              <span className="text-foam-300">Maritime Services</span>
            </h1>
            <p className="text-xl max-[768px]:text-lg text-ocean-100/90 leading-relaxed max-w-2xl mx-auto drop-shadow">
              From elite brokerage to vessel sale & purchase, we provide
              end-to-end maritime solutions tailored to the unique needs of the
              MENA shipping market.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-32 max-[1024px]:py-24 max-[768px]:py-20 relative">
        <div className="container">
          <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-8 max-[768px]:gap-6">
            {services.map((service, index) => (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true, margin: "-50px" }}
                className="group relative bg-white rounded-3xl p-10 max-[1024px]:p-8 max-[768px]:p-6 border border-slate-200/60 shadow-lg shadow-slate-200/40 hover:shadow-2xl hover:shadow-ocean-500/10 transition-all duration-500 hover:-translate-y-1 flex flex-col h-full overflow-hidden"
              >
                <div className="absolute inset-x-8 top-0 h-1 rounded-b-full bg-linear-to-r from-ocean-400 to-foam-400 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-8 bg-ocean-50 text-ocean-600 group-hover:bg-ocean-600 group-hover:text-white transition-colors duration-500">
                  <service.icon className="h-8 w-8 transition-colors duration-500" />
                </div>

                <h3 className="text-2xl font-bold text-ocean-900 mb-4 tracking-tight">
                  {service.title}
                </h3>
                <p className="text-slate-600 leading-relaxed flex-1">
                  {service.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-32 max-[1024px]:py-24 max-[768px]:py-20 bg-white border-t border-slate-100 relative overflow-hidden">
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-ocean-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

        <div className="container relative z-10">
          <div className="grid grid-cols-12 max-[1024px]:grid-cols-1 gap-24 max-[1024px]:gap-12">
            <div className="col-span-4 max-[1024px]:col-span-1 relative">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6 }}
                viewport={{ once: true }}
                className="sticky top-32 max-[1024px]:relative max-[1024px]:top-auto"
              >
                <span className="inline-block text-xs font-bold tracking-widest uppercase mb-4 px-4 py-1.5 rounded-full bg-ocean-50 text-ocean-700 border border-ocean-100">
                  Knowledge Base
                </span>
                <h2 className="text-5xl max-[1024px]:text-4xl max-[768px]:text-3xl font-bold text-ocean-900 mb-6 tracking-tight leading-tight">
                  Frequently Asked <br />
                  <span className="bg-linear-to-r from-ocean-600 to-foam-500 bg-clip-text text-transparent">
                    Questions
                  </span>
                </h2>
                <p className="text-slate-600 text-lg leading-relaxed mb-10">
                  Get clear, transparent answers about our maritime brokerage
                  processes, expertise, and operational standards.
                </p>
                <Button
                  asChild
                  variant="outline"
                  className="inline-flex max-[768px]:hidden h-14 px-8 border-slate-200 text-ocean-700 hover:text-ocean-900 hover:bg-ocean-50 hover:border-ocean-300 rounded-xl font-semibold shadow-sm transition-all"
                >
                  <Link href="/contact">Still have questions? Contact us</Link>
                </Button>
              </motion.div>
            </div>

            <div className="col-span-8 max-[1024px]:col-span-1">
              <div className="space-y-5">
                {faqs.map((faq, index) => {
                  const isOpen = openFaqIndex === index;
                  const faqNumber = (index + 1).toString().padStart(2, "0");

                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      viewport={{ once: true }}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border transition-all duration-500",
                        isOpen
                          ? "bg-white border-ocean-200 shadow-xl shadow-ocean-900/5 ring-1 ring-ocean-900/5"
                          : "bg-slate-50/50 border-slate-200/60 hover:border-ocean-300/60 hover:bg-slate-50",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute left-0 top-0 bottom-0 w-1.5 bg-linear-to-b from-ocean-500 to-foam-400 transition-transform duration-500 origin-top",
                          isOpen ? "scale-y-100" : "scale-y-0",
                        )}
                      />

                      <button
                        onClick={() => toggleFaq(index)}
                        className="w-full flex items-center justify-between p-8 max-[768px]:p-6 text-left focus:outline-none focus-visible:bg-slate-50 transition-colors"
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center max-[768px]:items-start gap-6 max-[768px]:gap-4 pr-8">
                          <span
                            className={cn(
                              "text-base max-[768px]:text-sm font-bold font-mono tracking-wider transition-colors duration-500 pt-0 max-[768px]:pt-1 shrink-0",
                              isOpen ? "text-ocean-500" : "text-slate-400",
                            )}
                          >
                            {faqNumber}
                          </span>
                          <span
                            className={cn(
                              "text-xl max-[768px]:text-lg font-bold tracking-tight transition-colors duration-500",
                              isOpen ? "text-ocean-900" : "text-slate-700",
                            )}
                          >
                            {faq.question}
                          </span>
                        </div>
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 border",
                            isOpen
                              ? "bg-ocean-50 border-ocean-100 text-ocean-600 shadow-sm rotate-180"
                              : "bg-white border-slate-200 text-slate-400 hover:border-ocean-200 hover:text-ocean-500",
                          )}
                        >
                          <ChevronDown className="w-5 h-5" />
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{
                              duration: 0.4,
                              ease: [0.04, 0.62, 0.23, 0.98],
                            }}
                          >
                            <div className="px-8 max-[768px]:px-6 pb-8 max-[768px]:pb-6 ml-12 max-[768px]:ml-0 text-slate-600 text-lg max-[768px]:text-base leading-relaxed whitespace-pre-line border-t border-slate-100/50 pt-6">
                              {faq.answer}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 max-[768px]:py-20 bg-ocean-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(43,185,211,0.15),transparent_60%)] pointer-events-none" />
        <div className="container relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-4xl max-[768px]:text-3xl font-bold text-white mb-6 tracking-tight">
              Ready to Secure Your Next Fixture?
            </h2>
            <p className="text-ocean-100 text-lg mb-10 leading-relaxed">
              Partner with Arab ShipBroker for unmatched market intelligence,
              transparent negotiation, and flawless execution.
            </p>
            <div className="flex flex-row max-[768px]:flex-col gap-4 justify-center">
              <Button
                asChild
                size="lg"
                className="h-14 px-8 bg-foam-500 hover:bg-foam-600 text-ocean-950 font-bold rounded-xl shadow-lg shadow-foam-500/25 transition-all hover:-translate-y-1 group"
              >
                <Link href="/contact">
                  <Phone className="mr-2 h-5 w-5" />
                  Contact Our Brokers
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                className="h-14 px-8 bg-foam-500 hover:bg-foam-600 text-ocean-950 font-bold rounded-xl shadow-lg shadow-foam-500/25 transition-all hover:-translate-y-1 group"
              >
                <Link href="/auth/signup">
                  Join the Platform
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

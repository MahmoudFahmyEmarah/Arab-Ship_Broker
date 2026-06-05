"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  Shield,
  ScrollText,
  AlertCircle,
  Scale,
  FileCheck,
  Lock,
  CreditCard,
  UserCheck,
  HelpCircle,
} from "lucide-react";

const termsSections = [
  {
    id: "acceptance-of-terms",
    icon: <FileCheck className="w-5 h-5" />,
    title: "1. Acceptance of Terms",
    content: (
      <div className="space-y-4">
        <p>
          By accessing or using the Arab Ship Broker online platform (the{" "}
          <strong>“Platform”</strong>), you (the <strong>“User”</strong>) agree
          to be bound by these Terms and Conditions (the{" "}
          <strong>“Terms”</strong>). These Terms constitute a legally binding
          agreement between you and <strong>Arab ShipBroker</strong> (the{" "}
          <strong>“Company”</strong>, <strong>“we”</strong> or{" "}
          <strong>“us”</strong>) regarding the use of our website, services, and
          any related applications.
        </p>
        <p>
          If you do not agree with any part of these Terms or our Privacy
          Policy, you must refrain from using the Platform.
        </p>
      </div>
    ),
  },
  {
    id: "description-of-services",
    icon: <ScrollText className="w-5 h-5" />,
    title: "2. Description of Services",
    content: (
      <div className="space-y-4">
        <p>
          <strong>Arab ShipBroker</strong> provides a digital maritime brokerage
          platform that enables Users to list available cargoes and vessels and
          to connect with each other for potential shipping or charter deals
          (the <strong>“Services”</strong>). Our Platform facilitates{" "}
          <strong>listing and brokering deals</strong> between{" "}
          <strong>cargo owners (shippers/charterers)</strong> and{" "}
          <strong>vessel owners (ship owners/operators)</strong>, as well as
          their authorized representatives (such as brokers or agents).
        </p>
        <p>
          We act <strong>solely as an intermediary</strong> to introduce and
          match Users, using online listings and tools to optimize connections
          in the shipping market.
        </p>
        <div className="bg-blue-50 border-l-4 border-blue-600 p-5 rounded-r-xl shadow-sm">
          <p className="text-sm font-bold text-blue-900 mb-1">Key Features:</p>
          <p className="text-sm text-blue-800 leading-relaxed">
            Users can post listings for cargo shipping opportunities or vessel
            availabilities, search and view listings, and communicate or
            negotiate potential contracts through the Platform’s interface.
            Additional premium tools or services may be offered to enhance the
            brokerage process.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "user-eligibility",
    icon: <UserCheck className="w-5 h-5" />,
    title: "3. User Eligibility and Account Registration",
    content: (
      <div className="space-y-4">
        <p>
          By registering an account or using the Platform, you represent that
          you are at least 18 years old (or the legal age of majority in your
          jurisdiction) and capable of entering into binding contracts. You also
          confirm that you are either the actual cargo owner or vessel owner, or
          an authorized representative (agent/broker) acting on their behalf,
          with full authority to engage in listing and negotiating deals on the
          Platform.
        </p>
        <p>
          If you are an individual shipbroker who circulates offers, you further
          acknowledge and confirm that you have exercised reasonable efforts and
          due diligence to verify the accuracy, authenticity, and legitimacy of
          the data you list or circulate, to the best of your professional
          ability.
        </p>
        <p>
          <strong>Account Information:</strong> Users must create an account to
          access certain features. All information you provide during
          registration or in your profile must be truthful, current, and
          complete. You are responsible for maintaining the confidentiality of
          your login credentials and for all activities that occur under your
          account.
        </p>
        <p>
          We reserve the right to suspend or terminate any account that violates
          these Terms or where we suspect unauthorized or fraudulent activity.
        </p>
      </div>
    ),
  },
  {
    id: "user-obligations",
    icon: <Shield className="w-5 h-5" />,
    title: "4. User Obligations and Prohibited Conduct",
    content: (
      <div className="space-y-4">
        <p>All Users of the Platform agree to the following obligations:</p>
        <ul className="list-disc pl-6 space-y-3 marker:text-blue-500">
          <li>
            <strong>Accurate and Lawful Information:</strong> You are solely
            responsible for all information and content you post. Any data or
            listing you submit must be truthful, accurate, up-to-date, and
            lawful.
          </li>
          <li>
            <strong>No Infringing or Harmful Content:</strong> You shall not
            post content that infringes the rights of any third party or any
            content that is illegal, offensive, defamatory, or otherwise
            objectionable.
          </li>
          <li>
            <strong>No Circumvention or Abuse:</strong> You agree not to use the
            Platform in an attempt to bypass or circumvent any fees or usage
            limits. Purposely sharing direct contact details to transact outside
            the Platform for the purpose of evading paid services is strictly
            prohibited.
          </li>
          <li>
            <strong>Compliance with Laws:</strong> You must comply with all
            applicable laws including maritime trade laws, sanctions,
            anti-bribery regulations, and data protection laws.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: "listing-services",
    icon: <ScrollText className="w-5 h-5" />,
    title: "5. Listing Services and User Content",
    content: (
      <div className="space-y-6">
        <section>
          <h3 className="font-semibold text-slate-900 mb-2">
            5.1 Free Listing of Data
          </h3>
          <p>
            Creating <strong>listings on the Platform is free of charge</strong>
            . In exchange for this free listing service, you grant us certain
            rights to use the content/data you provide, and you acknowledge that{" "}
            <strong>
              no monetary compensation is owed to you for such use
            </strong>
            .
          </p>
        </section>
        <section>
          <h3 className="font-semibold text-slate-900 mb-2">
            5.2 License and Rights to Use User Content
          </h3>
          <p>
            By submitting User Content, you retain ownership but grant the
            Company a{" "}
            <strong>
              worldwide, perpetual, royalty-free, non-exclusive license
            </strong>{" "}
            to use, reproduce, distribute, and display your User Content for the
            purpose of operating, promoting, and improving the Services.
          </p>
        </section>
        <section>
          <h3 className="font-semibold text-slate-900 mb-2">
            5.3 Personal Data and Privacy
          </h3>
          <p>
            Any personal data you provide will be handled in accordance with our{" "}
            <strong>Privacy Policy</strong>. By submitting data, you authorize
            the Company to process and use that information as necessary to
            provide the Services.
          </p>
        </section>
      </div>
    ),
  },
  {
    id: "fees",
    icon: <CreditCard className="w-5 h-5" />,
    title: "6. Fees and Paid Services",
    content: (
      <div className="space-y-4">
        <p>
          While core listing is free,{" "}
          <strong>additional services or premium features</strong> may be
          offered on a paid basis.
        </p>
        <ul className="list-disc pl-6 space-y-3 marker:text-blue-500">
          <li>
            <strong>Pricing and Payment:</strong> You agree to pay the fees
            associated with those Services as described on the Platform. All
            fees are exclusive of taxes unless stated otherwise.
          </li>
          <li>
            <strong>No Refunds:</strong> Fees for paid Services are generally
            non-refundable once the service period starts.
          </li>
          <li>
            <strong>Changes to Fees:</strong> The Company may change its fees
            from time to time. Any changes will be communicated in advance and
            will not affect services already paid for.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: "role-of-company",
    icon: <HelpCircle className="w-5 h-5" />,
    title: "7. Role of the Company and No Agency Relationship",
    content: (
      <div className="space-y-4">
        <p>
          <strong>Neutral Facilitator:</strong> Arab Ship Broker operates the
          Platform as a neutral venue.{" "}
          <strong>We do not become a party to any contracts</strong> that Users
          may enter into with each other.
        </p>
        <p>
          <strong>No Agency or Partnership:</strong> Use of our Services does
          not create any agency, partnership, joint venture, or employment
          relationship between you and us.
        </p>
        <p>
          <strong>No Warranty of Performance:</strong> We do not guarantee that
          Users will complete a deal or honor their commitments. We do not
          supervise logistics, payments, or performance of contracts.
        </p>
        <p>
          <strong>No Legal Advice:</strong> Any information available through
          the Platform is for general assistance only. The Company does not
          engage in providing legal, financial, or professional advice.
        </p>
      </div>
    ),
  },
  {
    id: "disclaimers",
    icon: <AlertCircle className="w-5 h-5" />,
    title: "8. Disclaimers of Warranties",
    content: (
      <div className="space-y-4 italic bg-slate-50 p-6 rounded-xl border border-slate-200">
        <p>
          The Platform and all Services are provided on an{" "}
          <strong>“as is” and “as available”</strong> basis without any
          warranties of any kind.
        </p>
        <p>
          We make no warranty regarding the authenticity, quality, or
          reliability of any content or listings provided by Users. User Content
          is not verified or approved by us in advance.
        </p>
      </div>
    ),
  },
  {
    id: "liability",
    icon: <Scale className="w-5 h-5" />,
    title: "9. Limitation of Liability",
    content: (
      <div className="space-y-4">
        <p>
          <strong>No Liability for User Transactions:</strong> Arab Ship Broker
          is not liable for any disputes, losses, or damages arising out of
          transactions between Users.
        </p>
        <p>
          <strong>Indirect Damages:</strong> The Company shall not be liable for
          any indirect, consequential, special, or incidental damages including
          loss of profits or opportunities.
        </p>
        <p>
          <strong>Liability Cap:</strong> Our total cumulative liability shall
          not exceed the total amount of fees you have paid to us in the 12
          months preceding the event.
        </p>
      </div>
    ),
  },
  {
    id: "indemnification",
    icon: <Shield className="w-5 h-5" />,
    title: "10. Indemnification",
    content: (
      <p>
        You agree to indemnify, defend, and hold harmless Arab Ship Broker and
        its affiliates from and against any claims, liabilities, or losses
        arising from your use of the Platform, your breach of these Terms, your
        User Content, or any dispute with another User.
      </p>
    ),
  },
  {
    id: "ip-rights",
    icon: <Lock className="w-5 h-5" />,
    title: "11. Intellectual Property Rights",
    content: (
      <div className="space-y-4">
        <p>
          <strong>Platform IP:</strong> All content excluding User Content is
          the proprietary property of the Company. You are granted a limited,
          revocable license to access the Platform for lawful purposes.
        </p>
        <p>
          <strong>User Content Ownership:</strong> You retain ownership of your
          User Content, but grant us the license mentioned in Section 5.
        </p>
      </div>
    ),
  },
  {
    id: "termination",
    icon: <FileCheck className="w-5 h-5" />,
    title: "12. Termination of Use",
    content: (
      <p>
        We reserve the right to suspend or terminate your account at our
        discretion if we believe you have violated these Terms or engaged in
        illegal activities. You may also cease using the Platform at any time.
      </p>
    ),
  },
  {
    id: "governing-law",
    icon: <Scale className="w-5 h-5" />,
    title: "13. Governing Law and Dispute Resolution",
    content: (
      <p>
        These Terms shall be{" "}
        <strong>
          governed by and construed in accordance with the laws of the United
          Arab Emirates (UAE)
        </strong>
        . Any disputes shall be subject to the exclusive jurisdiction of the
        competent courts of the UAE.
      </p>
    ),
  },
  {
    id: "changes",
    icon: <AlertCircle className="w-5 h-5" />,
    title: "14. Changes to Terms",
    content: (
      <p>
        The Company may amend these Terms from time to time. Material changes
        will be notified to Users. Continued use after updates constitutes
        acceptance of the revised Terms.
      </p>
    ),
  },
  {
    id: "miscellaneous",
    icon: <HelpCircle className="w-5 h-5" />,
    title: "15. Miscellaneous Provisions",
    content: (
      <div className="space-y-4">
        <p>
          <strong>Entire Agreement:</strong> These Terms constitute the entire
          agreement between you and the Company regarding the use of the
          Platform.
        </p>
        <p>
          <strong>Severability:</strong> If any provision is held to be invalid
          or unenforceable, such provision shall be enforced to the maximum
          extent permissible, and the remaining provisions will remain in full
          force.
        </p>
        <p>
          <strong>No Waiver:</strong> Failure to enforce any right or provision
          shall not constitute a waiver of such right or provision.
        </p>
        <p>
          <strong>Assignment:</strong> You may not assign your rights without
          our consent. The Company may freely assign these Terms.
        </p>
        <p>
          <strong>Language:</strong> These Terms are drawn up in English. If
          translated, the English text shall prevail in case of inconsistency.
        </p>
      </div>
    ),
  },
];

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-slate-50 selection:bg-blue-200 selection:text-blue-900 font-sans">
      {/* Header Section */}
      <header className="relative bg-slate-900 pt-32 pb-24 overflow-hidden">
        {/* Subtle background glow effect */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-20%,rgba(59,130,246,0.15),transparent)]" />

        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="max-w-3xl mx-auto"
          >
            <span className="inline-block text-xs font-bold tracking-widest uppercase mb-6 px-4 py-1.5 rounded-full bg-slate-800 text-blue-300 border border-slate-700">
              Legal Documents
            </span>
            <h1 className="text-6xl max-[1024px]:text-5xl max-[768px]:text-4xl font-extrabold text-white mb-6 tracking-tight">
              Terms & Conditions
            </h1>
            <p className="text-slate-300 text-xl max-[768px]:text-lg leading-relaxed">
              Please read these terms carefully before using the Arab Ship
              Broker Platform. These terms constitute a legally binding
              agreement.
            </p>
          </motion.div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="container mx-auto px-4 py-24 max-[1024px]:py-16 max-w-7xl">
        <div className="flex flex-row max-[1024px]:flex-col gap-16 max-[1280px]:gap-12">
          {/* Table of Contents - Sidebar */}
          <aside className="block max-[1024px]:hidden w-1/4 shrink-0">
            <nav
              aria-label="Table of Contents"
              className="sticky top-24 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 overflow-y-auto max-h-[calc(100vh-8rem)]"
            >
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
                On This Page
              </h2>
              <ul className="flex flex-col space-y-1.5">
                {termsSections.map((section) => {
                  // Extract just the title text without the number for a cleaner TOC
                  const cleanTitle =
                    section.title.split(". ")[1] || section.title;
                  return (
                    <li key={`toc-${section.id}`}>
                      <a
                        href={`#${section.id}`}
                        className="group flex items-start gap-3 px-3 py-2.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition-colors duration-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <span className="text-slate-400 group-hover:text-blue-600 mt-0.5 shrink-0">
                          {React.cloneElement(
                            section.icon as React.ReactElement<{
                              className?: string;
                            }>,
                            { className: "w-4 h-4" },
                          )}
                        </span>
                        <span className="font-medium leading-tight">
                          {cleanTitle}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          <article className="w-3/4 max-[1024px]:w-full space-y-12 max-[768px]:space-y-10">
            {termsSections.map((section, index) => (
              <motion.section
                key={section.id}
                id={section.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: Math.min(index * 0.05, 0.3),
                }}
                viewport={{ once: true, margin: "-100px" }}
                className="scroll-mt-32 bg-white rounded-2xl shadow-sm border border-slate-200 p-10 max-[768px]:p-6"
              >
                <header className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-100">
                  <div className="w-12 h-12 shrink-0 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    {section.icon}
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                    {section.title}
                  </h2>
                </header>

                <div className="text-slate-700 leading-relaxed text-lg max-[768px]:text-base">
                  {section.content}
                </div>
              </motion.section>
            ))}

            {/* Acknowledgement Footer */}
            <motion.section
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="pt-8"
            >
              <div className="bg-slate-900 text-white rounded-3xl p-12 max-[1024px]:p-10 max-[768px]:p-8 shadow-xl relative overflow-hidden text-center">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                <h2 className="text-2xl font-bold text-white mb-4 relative z-10">
                  Acknowledgment
                </h2>

                <p className="text-slate-300 leading-relaxed mb-8 max-w-2xl mx-auto relative z-10 text-lg max-[768px]:text-base">
                  By using the Arab Ship Broker Platform, you acknowledge that
                  you have read, understood, and agreed to all the above Terms
                  and Conditions. Thank you for using our Services.
                </p>
                <div className="inline-block bg-slate-800 rounded-full px-6 py-2 border border-slate-700 relative z-10">
                  <p className="text-slate-400 text-sm font-medium">
                    Last Updated: February 16, 2026
                  </p>
                </div>
              </div>
            </motion.section>
          </article>
        </div>
      </div>
    </div>
  );
}

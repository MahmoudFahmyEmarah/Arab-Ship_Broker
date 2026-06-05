"use client";

// Settings is a single surface with tabs. Billing is NOT a separate page — it
// lives here as the "Subscription & Billing" tab (the standalone /dashboard/billing
// nav entry was removed). The account form is server-rendered and passed in as a
// node so its data stays on the server; the billing panel is client-only.
import * as React from "react";
import { BillingPanel } from "@/components/portal/BillingPanel";
import { CompanyPanel } from "@/components/account/CompanyPanel";

type Tab = "account" | "company" | "billing";

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
        on
          ? "border-asb-blue text-asb-navy"
          : "border-transparent text-asb-gray-500 hover:text-asb-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

export function SettingsTabs({ account }: { account: React.ReactNode }) {
  const [tab, setTab] = React.useState<Tab>("account");
  return (
    <div className="px-6 py-6 md:px-8">
      <div className="mb-6 flex gap-1 border-b border-asb-gray-200">
        <TabButton on={tab === "account"} onClick={() => setTab("account")}>
          Account
        </TabButton>
        <TabButton on={tab === "company"} onClick={() => setTab("company")}>
          Company
        </TabButton>
        <TabButton on={tab === "billing"} onClick={() => setTab("billing")}>
          Subscription &amp; Billing
        </TabButton>
      </div>

      {tab === "account" && account}
      {tab === "company" && <CompanyPanel />}
      {tab === "billing" && (
        <div
          className="bg-white border border-asb-gray-200 rounded overflow-hidden"
          style={{ minHeight: "70vh", display: "flex", flexDirection: "column" }}
        >
          <BillingPanel />
        </div>
      )}
    </div>
  );
}

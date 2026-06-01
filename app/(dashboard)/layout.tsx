"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardProvider } from "@/contexts/DashboardContext";

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-asb-gray-50 flex">
      {/* Sidebar Component */}
      <DashboardSidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <button
        aria-label="Open menu"
        onClick={() => setMobileOpen(true)}
        className="hidden max-[1024px]:inline-flex fixed top-4 right-4 z-50 p-2.5 bg-white rounded shadow-sm border border-asb-gray-200 text-asb-gray-700 hover:text-asb-blue hover:bg-asb-gray-50 transition-colors"
      >
        <Menu className="w-6 h-6" />
      </button>

      <main className="flex-1 ml-[180px] max-[1024px]:ml-0 min-h-screen w-full transition-all duration-300 ease-in-out">
        <div className="p-10 max-[1024px]:p-8 max-[768px]:p-4 max-w-screen-2xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </DashboardProvider>
  );
}

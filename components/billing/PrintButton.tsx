"use client";

export function PrintButton({ className = "adm-btn primary" }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}

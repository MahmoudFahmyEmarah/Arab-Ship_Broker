import { cn } from "@/lib/utils";

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export function AdminPageHeader({
  title,
  subtitle,
  children,
  className,
}: AdminPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 flex-wrap mb-8",
        className,
      )}
    >
      <div>
        <h1 className="text-2xl font-bold text-asb-navy tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-asb-gray-500 mt-1">{subtitle}</p>}
      </div>
      {children && (
        <div className="flex items-center gap-2 flex-wrap">{children}</div>
      )}
    </div>
  );
}

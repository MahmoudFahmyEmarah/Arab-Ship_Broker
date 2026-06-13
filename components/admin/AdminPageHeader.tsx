// Admin page head — the design's PageHead: amber "Admin" breadcrumb crumb +
// title + optional subtitle, with optional right-aligned actions (children) and
// an optional inline warn strip. Shared by every admin page, so the whole
// console gets one consistent, navy/amber, breadcrumbed header.

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned action buttons. */
  children?: React.ReactNode;
  /** Optional inline amber warning strip beneath the head. */
  warn?: React.ReactNode;
}

export function AdminPageHeader({
  title,
  subtitle,
  children,
  warn,
}: AdminPageHeaderProps) {
  return (
    <>
      <div className="adm-page__head">
        <div>
          <h1 className="adm-page__title">
            <span className="adm-page__crumb">Admin</span>
            <span className="adm-page__crumb-sep">/</span>
            {title}
          </h1>
          {subtitle && <p className="adm-page__sub">{subtitle}</p>}
        </div>
        {children && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>}
      </div>
      {warn && (
        <div className="adm-page__warn">
          <span aria-hidden>⚠</span>
          {warn}
        </div>
      )}
    </>
  );
}

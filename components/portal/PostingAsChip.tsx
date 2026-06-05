import { activeOrg, currentMember, ORG_TYPE_LABEL } from "@/lib/portal/org";

// "Posting as · {company} · {type} · {tier} · You · {member}" header chip for
// Post Cargo. Listings circulate under the company desk; the person is shown as
// the handler. (Org is a DEMO stub until organization_members is wired.)
export function PostingAsChip() {
  const org = activeOrg();
  const me = currentMember();
  return (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs bg-asb-blue-light border border-asb-gray-200 rounded-full px-3 py-1.5">
      <span className="font-bold uppercase tracking-wider text-asb-gray-400">Posting as</span>
      <span className="font-semibold text-asb-navy">{org.name}</span>
      <span className="text-asb-gray-300">·</span>
      <span className="text-asb-gray-600">{ORG_TYPE_LABEL[org.type]}</span>
      <span className="text-asb-gray-300">·</span>
      <span className="font-semibold text-asb-blue">{org.tier}</span>
      <span className="text-asb-gray-300">·</span>
      <span className="text-asb-gray-500">You · {me.name}</span>
    </div>
  );
}

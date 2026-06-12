import { TeamBoard } from "@/components/portal/TeamBoard";

export const metadata = { title: "My Company — Arab ShipBroker" };
// Authed, client-data page — never static-prerender it.
export const dynamic = "force-dynamic";

export default function TeamPage() {
  return <TeamBoard />;
}

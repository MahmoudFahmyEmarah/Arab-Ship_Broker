// Optional Vercel snapshot for the console dashboard. Only runs when the
// server has VERCEL_TOKEN + VERCEL_PROJECT_ID (and optionally VERCEL_TEAM_ID);
// without them the dashboard shows an honest "not connected" chip instead of
// guessing. Never throws — a failed call degrades to null.
import type { VercelSnapshot } from "./types";

type VercelDeployment = {
  uid: string;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  ready?: number;
  url?: string;
  inspectorUrl?: string;
  meta?: Record<string, string | undefined>;
};

export async function fetchVercelSnapshot(): Promise<VercelSnapshot | null> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;

  const params = new URLSearchParams({ projectId, target: "production", limit: "1" });
  if (process.env.VERCEL_TEAM_ID) params.set("teamId", process.env.VERCEL_TEAM_ID);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { deployments?: VercelDeployment[] };
    const d = json.deployments?.[0];
    if (!d) return null;
    const created = d.createdAt ?? d.created ?? Date.now();
    return {
      state: (d.readyState ?? d.state ?? "UNKNOWN").toUpperCase(),
      created_at: new Date(created).toISOString(),
      ready_at: d.ready ? new Date(d.ready).toISOString() : null,
      sha: d.meta?.githubCommitSha ?? d.meta?.gitlabCommitSha ?? d.meta?.bitbucketCommitSha ?? null,
      message: d.meta?.githubCommitMessage ?? d.meta?.gitlabCommitMessage ?? d.meta?.bitbucketCommitMessage ?? null,
      branch: d.meta?.githubCommitRef ?? d.meta?.gitlabCommitRef ?? d.meta?.bitbucketCommitRef ?? null,
      url: d.url ?? null,
      inspector_url: d.inspectorUrl ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

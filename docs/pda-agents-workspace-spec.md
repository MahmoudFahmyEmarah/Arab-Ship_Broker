# PDA · Agents workspace — specification for owner decision

Status: **draft for the owner** (O2ALL-008: "Agents: spec first"; nothing is built until approved). Author: Opus, 18 Oct 2026.
Inputs: the approved reference design (`Fixture Room + Ports Cost Estimator - Standalone (2).html`, modules
`agent-portal-root`, `agent-portal-agency`, `agent-portal-request`, `agent-portal-review`, `verify-panel`), the design
contract (`docs/pda-estimator-design-contract.md`: the prototype's simulated agent workflow and browser stores are
**not** authorised), and what is already built (Ports, Setup, per-leg retry, saved estimate sets).

## 1. What the reference design intends

The reference Agents tab is one portal with two roles over one record store, plus a verification panel:

| Flow | Who | What happens |
|---|---|---|
| **Quote request** | broker / operator | Asks the attending agents **listed at that port** for a real PDA against a platform record (vessel, cargo, laycan and port resolved from the platform, never free text), then compares the returned quotes with their own estimate. |
| **Agency workspace** | an approved agency | Keeps its port page (fields and fees, berthing notes), answers quote requests, invites its team. **Every edit becomes a change set** for ASB review; nothing publishes directly. |
| **ASB review desk** | ASB | Two queues (agency claims, change sets) and a published log. |
| **Verification** | broker → third party → desk | Raised from a charge line, a port or a whole estimate. A reply waits "Under review" until the desk accepts it; the contributor is credited on accept. |

## 2. What already exists to build on

- `tariff_publishers.publisher_type` accepts `agent`; `tariff_sources.authority` accepts `agent`; FX rates accept an
  `agent` source kind; the maker/checker tariff publication pipeline already governs anything priced.
- Estimates accept **attributed manual quotes** (who entered it, reason/reference) and show them as manual lines.
- Saved estimate sets (increment A) are immutable and versioned: a quote can become a **new version** of a saved
  estimate without rewriting the old one.
- Notifications (Wave 4: in-app + email, pg_cron dispatch) for request/response events.
- The Fixture Room's masking rules for what a counterparty may see.

Missing: an agent registry (which agency attends which port, verified by whom), agent accounts and their seats, quote
requests and responses, change sets and a review desk for agent-submitted port data.

## 3. Decisions for the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **A1** | **Scope of the first release** | (a) read-only **agent directory** per port; (b) (a) + **quote requests** from a saved estimate, answered by the desk on the agent's behalf; (c) (b) + **agency accounts** answering themselves; (d) everything incl. agency-maintained port data and verification | **(b) first, then (c)** — real quotes reach members quickly with no third-party accounts to secure; (d) after (c) proves out |
| **A2** | **Who becomes a listed agent** | ASB invites and verifies only; agencies self-claim a port and the desk approves | **ASB-invited only** for the first release (no unvetted listings) |
| **A3** | **How a quote reaches the platform** | Desk enters the agent's emailed quote (with the document attached as evidence); agent account answers in the portal; email reply ingestion (Data Sync) | **Desk-entered with the document attached** for (b); agent accounts in (c) |
| **A4** | **What a quote does to the estimate** | Shown side by side only; becomes **attributed manual lines** in a new version of the saved estimate | **New version** with attributed lines (provenance = agent, quote reference, document) — the old version stays |
| **A5** | **What the agent sees of the request** | Full vessel/cargo/principal; masked like the Fixture Room (vessel class and size, cargo type and quantity, laycan, port; principal hidden until the member chooses to reveal) | **Masked by default**, member may reveal |
| **A6** | **Agent-submitted tariff data** | Never; through the existing maker/checker pipeline as `authority = agent` sources, desk-reviewed | **Through the pipeline**, never published directly (matches the reference "nothing publishes directly") |
| **A7** | **Commercial terms** | Free listing; paid listing / featured agents; per-request fee | Owner's call — the build is the same either way |

## 4. Proposed first release (A1 = b), if approved

Governed like the rest of the PDA module: RPC-only access, no browser stores, immutable records, service-only writes.

1. **Agent registry** — `pda_port_agents` (agency → port, verified by an admin, active/withdrawn), maintained in the admin
   console; members read the agents listed at a port in the Agents tab and on each port card.
2. **Quote request** — from a **saved** estimate set (never a live preview): the member picks listed agents for one or
   both ports; `pda_quote_requests` (immutable request snapshot with the masking of A5) and per-agent recipients.
3. **Desk response** — an admin records the agent's quote against the request (lines with amounts, currency, reference,
   the quote document as evidence in a private bucket), maker/checker like tariffs.
4. **Into the estimate** — the member accepts a quote: a **new version** of the saved set with the quote as attributed
   manual lines (A4); the comparison view shows estimate vs quote per port.
5. **Notifications** — request sent, quote received, quote accepted (Wave 4 core; owner-tier admin recipients only for the
   desk side, as for the Fixture Room).
6. **Tests** — the same pattern as increments A–D: SQL suites (grants, ownership, immutability, masking), pure/static checks,
   DB proof on a production-equivalent clone, Codex Tier-A audit.

Rough effort: registry + directory ~2 days; requests + desk response ~4–5 days; into-estimate + comparison ~2 days;
agency accounts (c) a further ~5–7 days after that (auth, seats, invites, their own masking and audit).

## 5. Explicitly out of scope until decided

Agency self-service accounts and team invites (A1 c/d), self-claimed listings (A2), email ingestion of quotes (A3),
agent-maintained port pages and change sets (A1 d), credits for contributors, and any commercial mechanics (A7).

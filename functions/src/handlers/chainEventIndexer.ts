// functions/src/handlers/chainEventIndexer.ts
//
// Entry points for the chain event indexer — scheduled Cloud Function. Both are thin wrappers
// around the same core cycle; the admin callable is the main way to force a run during
// development/ops without waiting for the schedule. Mirrors
// functions/src/handlers/userCredibilityBatch.ts's exact pairing.
//
// One combined scheduled function runs every registered contract's cycle (currently
// MemberRoleManager, HealthRecordCore) via runChainEventIndexerCycleForAllContracts, rather than
// a separate scheduled function per contract — a deliberate choice over per-contract isolation.
// Accepted trade-off: during a contract's one-time initial historical backfill, a single 540s
// tick may not have time to make progress on a later contract in CHAIN_INDEXER_CONTRACTS after an
// earlier one's scan completes (or vice versa). This is safe, not broken — runChainEventIndexerCycle
// persists its checkpoint after every chunk (the same mechanism that already fixed the
// 2026-09-11 timeout incident below), so a starved contract simply resumes exactly where it left
// off on the next tick; convergence just takes more ticks. CHAIN_INDEXER_CONTRACTS orders
// MemberRoleManager first specifically so its steady-state catch-up is never starved by a newer
// contract's one-time backfill.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { runChainEventIndexerCycleForAllContracts } from '../chainIndexer/chainEventIndexerService';

// Every 15 minutes — no urgency (see the plan's Context: this closes an audit/trust gap with no
// live functional impact, not a live bug), but frequent enough that a newly-discovered
// admin_untracked/sync_queue_confirmed_missing_write finding surfaces reasonably promptly.
//
// timeoutSeconds is explicit and deliberately kept well under the 15-minute schedule interval —
// Cloud Functions v2 defaults to 60s when unset, which is nowhere near enough for the initial
// historical backfill (hundreds of thousands of blocks from a contract's own deploymentBlock).
// Confirmed by a real incident: every run was silently killed mid-backfill, making only a sliver
// of progress per tick and leaving events permanently stuck at 'unclassified' (see
// sweepUnclassifiedEvents in chainEventIndexerService.ts for the self-healing fix for docs
// already stuck that way). 540s (9 min) leaves real headroom to finish a run before the next
// scheduled tick fires, avoiding overlapping invocations.
//
// secrets also lists ADMIN_WALLET_PRIVATE_KEY/RPC_URL (same pair memberRegistry.ts's handlers
// declare) even though this function never signs anything — each contract's reconciliation
// pipeline calls getAdminWallet() purely to read its .address for comparison (the
// admin-vs-other-signer check, or HRC Slice 1's infrastructure_admin_mismatch check). Firebase
// Functions v2 only injects a secret into process.env for a function that explicitly lists it —
// a real production incident confirmed the hard way that "some other function already declares
// this secret" doesn't help; every function needs its own declaration.
const ADMIN_WALLET_SECRETS = ['ALCHEMY_API_KEY', 'ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'];

export const runChainEventIndexer = onSchedule(
  { schedule: '*/15 * * * *', secrets: ADMIN_WALLET_SECRETS, timeoutSeconds: 540 },
  async () => {
    await runChainEventIndexerCycleForAllContracts();
  }
);

export const recomputeChainEventIndex = onCall({ secrets: ADMIN_WALLET_SECRETS, timeoutSeconds: 540 }, async request => {
  if (!request.auth?.token?.platformAdmin) {
    throw new HttpsError('permission-denied', 'Not authorized');
  }

  const results = await runChainEventIndexerCycleForAllContracts();
  return { success: true, results };
});

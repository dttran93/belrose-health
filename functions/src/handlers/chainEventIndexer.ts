// functions/src/handlers/chainEventIndexer.ts
//
// Entry points for the chain event indexer — scheduled Cloud Function. Both are thin wrappers
// around the same core cycle; the admin callable is the main way to force a run during
// development/ops without waiting for the schedule. Mirrors
// functions/src/handlers/userCredibilityBatch.ts's exact pairing.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { runChainEventIndexerCycle } from '../chainIndexer/chainEventIndexerService';

// Every 15 minutes — no urgency (see the plan's Context: this closes an audit/trust gap with no
// live functional impact, not a live bug), but frequent enough that a newly-discovered
// admin_untracked/sync_queue_confirmed_missing_write finding surfaces reasonably promptly.
//
// timeoutSeconds is explicit and deliberately kept well under the 15-minute schedule interval —
// Cloud Functions v2 defaults to 60s when unset, which is nowhere near enough for the initial
// historical backfill (hundreds of thousands of blocks from MEMBER_ROLE_MANAGER.deploymentBlock).
// Confirmed by a real incident: every run was silently killed mid-backfill, making only a sliver
// of progress per tick and leaving events permanently stuck at 'unclassified' (see
// sweepUnclassifiedEvents in chainEventIndexerService.ts for the self-healing fix for docs
// already stuck that way). 540s (9 min) leaves real headroom to finish a run before the next
// scheduled tick fires, avoiding overlapping invocations.
export const runChainEventIndexer = onSchedule(
  { schedule: '*/15 * * * *', secrets: ['ALCHEMY_API_KEY'], timeoutSeconds: 540 },
  async () => {
    await runChainEventIndexerCycle();
  }
);

export const recomputeChainEventIndex = onCall({ secrets: ['ALCHEMY_API_KEY'], timeoutSeconds: 540 }, async request => {
  if (!request.auth?.token?.platformAdmin) {
    throw new HttpsError('permission-denied', 'Not authorized');
  }

  const result = await runChainEventIndexerCycle();
  return { success: true, ...result };
});

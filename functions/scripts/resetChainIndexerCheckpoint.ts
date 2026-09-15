// functions/scripts/resetChainIndexerCheckpoint.ts
//
// One-off: deletes the chainIndexerCheckpoints doc for MemberRoleManager so the indexer's next
// cycle resumes from scratch at MEMBER_ROLE_MANAGER.deploymentBlock instead of wherever the
// checkpoint currently sits. Needed because the checkpoint is a single per-contract cursor, not
// per-event-type (see chainEventIndexerService.ts's runChainEventIndexerCycle: `startBlock =
// checkpoint ? checkpoint.lastScannedBlock + 1 : MEMBER_ROLE_MANAGER.deploymentBlock`) — every
// event type added across Slices 2-7 (RoleGranted/RoleRevoked, RoleChanged, MemberStatusChanged/
// OwnershipVoluntarilyLeft, the 5 Trustee events, VouchGiven/VouchRetracted,
// HealthRecordCoreUpdated/AdminTransferred) only ever got scanned for blocks *after* whatever the
// checkpoint had already reached when that slice shipped — never retroactively. This was
// deliberately deferred slice-by-slice and done once here, now that all 16 events on
// MemberRoleManager.sol are in the registry, so the full history only needs one rescan instead of
// N partial ones.
//
// Deletes the doc rather than reconstructing a fake `lastScannedBlock: deploymentBlock - 1` —
// getCheckpoint() already treats a missing doc as "start at deploymentBlock" (the same cold-start
// path every environment's very first-ever run already took and this codebase already trusts), so
// deleting reuses tested behavior instead of hand-rolling an equivalent doc shape.
//
// Deleting the checkpoint does NOT re-cache/re-reconcile anything by itself — it only makes the
// *next* indexer cycle rescan from deploymentBlock. That next cycle still has to actually run,
// either via the scheduled runChainEventIndexer (every 15 min) or by clicking "Run Indexer Now" on
// the Chain Events tab (recomputeChainEventIndex). A full rescan of this size will very likely
// take SEVERAL cycles, not one — runChainEventIndexerCycle persists its checkpoint after every
// chunk specifically so a 540s timeout only ever loses at most one chunk's progress, not the whole
// backfill (see chainEventIndexer.ts's timeoutSeconds comment for the incident that fix addressed).
// Re-scanning is safe and cheap on the Firestore side regardless of how many cycles it takes:
// cacheAndReconcile's docRef.create() no-ops on every doc already cached from a prior slice
// (isAlreadyExistsError), so this only re-does RPC calls, never duplicate writes or
// reconciliations for events already correctly classified.
//
// Usage:
//   cd functions
//   npx tsx scripts/resetChainIndexerCheckpoint.ts             # dry run — prints current
//                                                               # checkpoint + a scan-size estimate,
//                                                               # deletes nothing
//   npx tsx scripts/resetChainIndexerCheckpoint.ts --execute   # deletes the checkpoint doc

import * as admin from 'firebase-admin';
import * as path from 'path';
import { getFirestore } from 'firebase-admin/firestore';
import { MEMBER_ROLE_MANAGER, NETWORK_CORE, buildChainIndexerCheckpointDocId } from '../src/_shared';
import { CHAIN_EVENT_REGISTRY } from '../src/chainIndexer/eventRegistry';
import { getReadOnlyProvider } from '../src/chainIndexer/chainEventIndexerService';

// ── Firebase init ─────────────────────────────────────────────────────────────

const serviceAccount = require(path.join(__dirname, '..', '..', '.firebaseServiceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = getFirestore();

// ── Config ────────────────────────────────────────────────────────────────────

// Illustrative only — the real indexer adapts its chunk size on block-range errors
// (queryFilterWithBackoff), so the actual number of RPC calls a real run makes may differ.
const ILLUSTRATIVE_CHUNK_SIZE = 500;
const EVENT_TYPE_COUNT = Object.keys(CHAIN_EVENT_REGISTRY).length;
const REORG_CONFIRMATION_BUFFER = 20; // mirrors chainEventIndexerService.ts's own constant

const DRY_RUN = !process.argv.includes('--execute');

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Belrose: Reset chain event indexer checkpoint    ');
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN (pass --execute to write)' : '🚀 LIVE'}`);
  console.log('═══════════════════════════════════════════════════\n');

  const docId = buildChainIndexerCheckpointDocId(
    'MemberRoleManager',
    NETWORK_CORE.chainId,
    MEMBER_ROLE_MANAGER.proxy
  );
  const docRef = db.collection('chainIndexerCheckpoints').doc(docId);

  const snap = await docRef.get();
  if (!snap.exists) {
    console.log(`📭 No checkpoint doc found at chainIndexerCheckpoints/${docId} — nothing to reset.`);
    console.log('   The next indexer cycle will already start at MEMBER_ROLE_MANAGER.deploymentBlock.');
    process.exit(0);
  }

  const current = snap.data()!;
  console.log(`📄 Current checkpoint (chainIndexerCheckpoints/${docId}):`);
  console.log(`   lastScannedBlock: ${current.lastScannedBlock}`);
  console.log(`   lastRunAt:        ${current.lastRunAt?.toDate?.() ?? current.lastRunAt}`);
  console.log(`   lastRunStatus:    ${current.lastRunStatus}\n`);

  const provider = getReadOnlyProvider();
  const currentBlock = await provider.getBlockNumber();
  const targetBlock = currentBlock - REORG_CONFIRMATION_BUFFER;
  const blocksToRescan = targetBlock - MEMBER_ROLE_MANAGER.deploymentBlock;
  const estimatedChunks = Math.ceil(blocksToRescan / ILLUSTRATIVE_CHUNK_SIZE);
  const estimatedFilterCalls = estimatedChunks * EVENT_TYPE_COUNT;

  console.log('📊 Full-history rescan estimate (illustrative, actual chunking adapts on errors):');
  console.log(`   deploymentBlock → current: ${MEMBER_ROLE_MANAGER.deploymentBlock} → ${targetBlock} (${blocksToRescan.toLocaleString()} blocks)`);
  console.log(`   ~${estimatedChunks.toLocaleString()} chunks × ${EVENT_TYPE_COUNT} event filters ≈ ${estimatedFilterCalls.toLocaleString()} RPC calls`);
  console.log('   This will very likely take multiple indexer cycles to complete, not one —');
  console.log('   click "Run Indexer Now" on the Chain Events tab repeatedly, or let the 15-minute');
  console.log('   schedule grind through it. Progress is checkpointed after every chunk, so it is');
  console.log('   always safe to stop and resume.\n');

  if (DRY_RUN) {
    console.log('🧪 Dry run — no changes made. Pass --execute to delete this checkpoint doc.');
    process.exit(0);
  }

  await docRef.delete();
  console.log(`✅ Deleted chainIndexerCheckpoints/${docId}.`);
  console.log('   The next indexer cycle (scheduled or "Run Indexer Now") will start fresh at');
  console.log(`   block ${MEMBER_ROLE_MANAGER.deploymentBlock}.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

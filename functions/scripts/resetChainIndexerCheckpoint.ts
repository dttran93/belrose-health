// functions/scripts/resetChainIndexerCheckpoint.ts
//
// One-off: deletes the chainIndexerCheckpoints doc for every contract the indexer covers
// (CHAIN_INDEXER_CONTRACTS — currently MemberRoleManager and HealthRecordCore) so each one's next
// cycle resumes from scratch at its own deploymentBlock instead of wherever its checkpoint
// currently sits. Needed because each checkpoint is a single per-contract cursor, not per-event-
// type (see chainEventIndexerService.ts's runChainEventIndexerCycle: `startBlock = checkpoint ?
// checkpoint.lastScannedBlock + 1 : config.deploymentBlock`) — every event type added across
// MemberRoleManager's Slices 2-7 and HealthRecordCore's HRC Slices 1-6 only ever got scanned for
// blocks *after* whatever the checkpoint had already reached when that slice shipped — never
// retroactively. This was deliberately deferred slice-by-slice (and contract-by-contract) and done
// once here, now that every event on both contracts is in the registry, so the full history only
// needs one rescan per contract instead of N partial ones.
//
// Deletes each doc rather than reconstructing a fake `lastScannedBlock: deploymentBlock - 1` —
// getCheckpoint() already treats a missing doc as "start at deploymentBlock" (the same cold-start
// path every environment's very first-ever run already took and this codebase already trusts), so
// deleting reuses tested behavior instead of hand-rolling an equivalent doc shape.
//
// Deleting a checkpoint does NOT re-cache/re-reconcile anything by itself — it only makes that
// contract's *next* indexer cycle rescan from deploymentBlock. That next cycle still has to
// actually run, either via the scheduled runChainEventIndexer (runs both contracts every 15 min
// via runChainEventIndexerCycleForAllContracts) or by clicking "Run Indexer Now" on the Chain
// Events tab. A full rescan of this size will very likely take SEVERAL cycles per contract, not
// one — runChainEventIndexerCycle persists its checkpoint after every chunk specifically so a 540s
// timeout only ever loses at most one chunk's progress, not the whole backfill (see
// chainEventIndexer.ts's timeoutSeconds comment for the incident that fix addressed). Re-scanning
// is safe and cheap on the Firestore side regardless of how many cycles it takes:
// cacheAndReconcile's docRef.create() no-ops on every doc already cached from a prior slice
// (isAlreadyExistsError), so this only re-does RPC calls, never duplicate writes or
// reconciliations for events already correctly classified.
//
// Usage:
//   cd functions
//   npx tsx scripts/resetChainIndexerCheckpoint.ts             # dry run — prints current
//                                                               # checkpoints + scan-size estimates
//                                                               # for every contract, deletes nothing
//   npx tsx scripts/resetChainIndexerCheckpoint.ts --execute   # deletes every contract's checkpoint doc

import * as admin from 'firebase-admin';
import * as path from 'path';
import { getFirestore } from 'firebase-admin/firestore';
import { NETWORK_CORE, buildChainIndexerCheckpointDocId } from '../src/_shared';
import { CHAIN_INDEXER_CONTRACTS, getReadOnlyProvider } from '../src/chainIndexer/chainEventIndexerService';

// ── Firebase init ─────────────────────────────────────────────────────────────

const serviceAccount = require(path.join(__dirname, '..', '..', '.firebaseServiceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = getFirestore();

// ── Config ────────────────────────────────────────────────────────────────────

// Illustrative only — the real indexer adapts its chunk size on block-range errors
// (queryFilterWithBackoff), so the actual number of RPC calls a real run makes may differ.
const ILLUSTRATIVE_CHUNK_SIZE = 500;
const REORG_CONFIRMATION_BUFFER = 20; // mirrors chainEventIndexerService.ts's own constant

const DRY_RUN = !process.argv.includes('--execute');

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Belrose: Reset chain event indexer checkpoints   ');
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN (pass --execute to write)' : '🚀 LIVE'}`);
  console.log(`   Contracts: ${CHAIN_INDEXER_CONTRACTS.map(c => c.contract).join(', ')}`);
  console.log('═══════════════════════════════════════════════════\n');

  const provider = getReadOnlyProvider();
  const currentBlock = await provider.getBlockNumber();
  const targetBlock = currentBlock - REORG_CONFIRMATION_BUFFER;

  for (const config of CHAIN_INDEXER_CONTRACTS) {
    console.log(`\n── ${config.contract} ──────────────────────────────────`);

    const docId = buildChainIndexerCheckpointDocId(config.contract, NETWORK_CORE.chainId, config.proxyAddress);
    const docRef = db.collection('chainIndexerCheckpoints').doc(docId);

    const snap = await docRef.get();
    const eventTypeCount = Object.keys(config.registry).length;

    if (!snap.exists) {
      console.log(`📭 No checkpoint doc found at chainIndexerCheckpoints/${docId} — nothing to reset.`);
      console.log(`   The next cycle will already start at block ${config.deploymentBlock}.`);
      continue;
    }

    const current = snap.data()!;
    console.log(`📄 Current checkpoint (chainIndexerCheckpoints/${docId}):`);
    console.log(`   lastScannedBlock: ${current.lastScannedBlock}`);
    console.log(`   lastRunAt:        ${current.lastRunAt?.toDate?.() ?? current.lastRunAt}`);
    console.log(`   lastRunStatus:    ${current.lastRunStatus}`);

    const blocksToRescan = targetBlock - config.deploymentBlock;
    const estimatedChunks = Math.ceil(blocksToRescan / ILLUSTRATIVE_CHUNK_SIZE);
    const estimatedFilterCalls = estimatedChunks * eventTypeCount;

    console.log('📊 Full-history rescan estimate (illustrative, actual chunking adapts on errors):');
    console.log(`   deploymentBlock → current: ${config.deploymentBlock} → ${targetBlock} (${blocksToRescan.toLocaleString()} blocks)`);
    console.log(`   ~${estimatedChunks.toLocaleString()} chunks × ${eventTypeCount} event filters ≈ ${estimatedFilterCalls.toLocaleString()} RPC calls`);

    if (DRY_RUN) {
      console.log('🧪 Dry run — no changes made. Pass --execute to delete this checkpoint doc.');
      continue;
    }

    await docRef.delete();
    console.log(`✅ Deleted chainIndexerCheckpoints/${docId}.`);
    console.log(`   The next cycle will start fresh at block ${config.deploymentBlock}.`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  if (!DRY_RUN) {
    console.log('   All checkpoints reset. This will very likely take several indexer cycles per');
    console.log('   contract to fully catch up — click "Run Indexer Now" on the Chain Events tab');
    console.log('   repeatedly, or let the 15-minute schedule (runChainEventIndexerCycleForAllContracts,');
    console.log('   MemberRoleManager first each tick) grind through it. Progress is checkpointed');
    console.log('   after every chunk per contract, so it is always safe to stop and resume.');
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

// functions/scripts/reclassifyDeactivatedChainEvents.ts
//
// One-off backfill: reconcileMemberEvent (functions/src/chainIndexer/reconciliationService.ts)
// learned a new classification — 'deactivated_tracked', for a MemberRegistered/WalletLinked
// event with no Firestore match whose identity is Inactive on-chain (the signature of e2e test
// cleanup deactivating-then-deleting an account — see e2e/helpers/backend/staging.ts's
// deactivateOnChain). That check only runs going forward, on newly-cached events — it doesn't
// retroactively touch chainEventCache docs already classified as 'admin_untracked' or
// 'sync_queue_confirmed_missing_write' before the check existed. This script re-runs the exact
// same production reconcileMemberEvent against those existing docs so the Chain Events tab
// reflects the current, more accurate classification instead of the stale one — purely a display
// correction, no chain writes, nothing except chainEventCache docs get touched.
//
// Imports and calls the real reconcileMemberEvent rather than reimplementing its logic, so this
// is guaranteed to produce exactly what the live indexer would produce for the same input —
// never a second, potentially-drifting copy of the classification rules.
//
// Usage:
//   cd functions
//   npx tsx scripts/reclassifyDeactivatedChainEvents.ts             # dry run — no writes
//   npx tsx scripts/reclassifyDeactivatedChainEvents.ts --execute   # live run

import * as admin from 'firebase-admin';
import * as path from 'path';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { getFirestore } from 'firebase-admin/firestore';
import { reconcileMemberEvent } from '../src/chainIndexer/reconciliationService';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

// reconcileMemberEvent (via getAdminWallet) reads process.env.ADMIN_WALLET_PRIVATE_KEY — the
// deployed Cloud Function's secret name. This repo's scripts (reregisterUsers.ts,
// purgeStaleE2eDependents.ts) instead standardize on .env.local's PRIVATE_KEY for the same key,
// so developers only ever need one copy of it locally. Bridge the two names here rather than
// asking for a second copy of the same secret under a different name. Safe to do at this point
// in the file (before any call into reconcileMemberEvent) even though it comes after the imports
// above — nothing in that import chain reads either env var at module-load time, only lazily
// inside function bodies, called later from main() below.
if (process.env.PRIVATE_KEY && !process.env.ADMIN_WALLET_PRIVATE_KEY) {
  process.env.ADMIN_WALLET_PRIVATE_KEY = process.env.PRIVATE_KEY;
}

// ── Firebase init ─────────────────────────────────────────────────────────────

const serviceAccount = require(path.join(__dirname, '..', '..', '.firebaseServiceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = getFirestore();

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = 'https://sepolia.base.org'; // matches reregisterUsers.ts/purgeStaleE2eDependents.ts's convention
const CANDIDATE_STATUSES = ['admin_untracked', 'sync_queue_confirmed_missing_write'];
const MEMBER_EVENT_NAMES = ['MemberRegistered', 'WalletLinked'];

const DRY_RUN = !process.argv.includes('--execute');

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Belrose: Reclassify deactivated chain events    ');
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN (pass --execute to write)' : '🚀 LIVE'}`);
  console.log('═══════════════════════════════════════════════════\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Single equality filter (contract) — Firestore only allows one `in`/disjunctive clause per
  // query, and this needs two (eventName, reconciliationStatus), so filter those in-memory
  // instead of trying to express them server-side. Volume here is low hundreds of docs at most —
  // a one-off ops script, not a hot path.
  const snapshot = await db.collection('chainEventCache').where('contract', '==', 'MemberRoleManager').get();
  const candidates = snapshot.docs.filter(doc => {
    const data = doc.data();
    return MEMBER_EVENT_NAMES.includes(data.eventName) && CANDIDATE_STATUSES.includes(data.reconciliationStatus);
  });
  console.log(`📦 Found ${candidates.length} candidate docs (of ${snapshot.size} MemberRoleManager events total)\n`);

  const transitionCounts = new Map<string, number>();
  let unchanged = 0;
  let failed = 0;

  for (const doc of candidates) {
    const data = doc.data();
    const oldStatus = data.reconciliationStatus as string;

    try {
      const classification = await reconcileMemberEvent(db, provider, data as any);
      const newStatus = classification.reconciliationStatus;

      if (newStatus === oldStatus) {
        unchanged++;
        continue;
      }

      const transitionKey = `${oldStatus} → ${newStatus}`;
      transitionCounts.set(transitionKey, (transitionCounts.get(transitionKey) ?? 0) + 1);
      console.log(`${doc.id}: ${transitionKey}`);

      if (!DRY_RUN) {
        await doc.ref.update(classification);
      }
    } catch (err) {
      console.error(`   ❌ ${doc.id} failed:`, err);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`   Candidates checked: ${candidates.length}`);
  console.log(`   Unchanged:          ${unchanged}`);
  for (const [transition, count] of transitionCounts) {
    console.log(`   ${transition}: ${count}`);
  }
  console.log(`   Failed:             ${failed}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

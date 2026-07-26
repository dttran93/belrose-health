// functions/scripts/purgeStaleE2eDependents.ts
//
// One-off cleanup for dependent accounts e2e/dependents.spec.ts left behind on staging
// (belrose-757fe) before its afterEach cleanup existed — see e2e/dependents.spec.ts and
// e2e/helpers/backend/staging.ts. Matches by firstName ('Little'/'Switchy', the two names that
// spec hardcodes), deactivates each on-chain (MemberRoleManager.setUserStatus → Inactive, same as
// staging.ts's deactivateOnChain), then deletes the Auth user and Firestore users/{uid} doc.
//
// Going forward this debris shouldn't reaccumulate — dependents.spec.ts now cleans up after
// itself every run — so this is meant to run once, not on a schedule.
//
// Usage:
//   cd functions
//   npx tsx scripts/purgeStaleE2eDependents.ts             # dry run — no writes
//   npx tsx scripts/purgeStaleE2eDependents.ts --execute   # live run

import * as admin from 'firebase-admin';
import * as path from 'path';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

// ── Firebase init ─────────────────────────────────────────────────────────────

const serviceAccount = require(path.join(__dirname, '..', '..', '.firebaseServiceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = 'https://sepolia.base.org';
const MRM_PROXY = '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B';
const MEMBER_STATUS_INACTIVE = 1;
// Same admin/deployer wallet reregisterUsers.ts already uses.
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const DRY_RUN = !process.argv.includes('--execute');

const ABI = ['function setUserStatus(bytes32 userIdHash, uint8 newStatus) external'];

function getContract() {
  if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY not set in .env.local');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  return new ethers.Contract(MRM_PROXY, ABI, signer);
}

async function deactivateOnChain(contract: ethers.Contract, uid: string): Promise<string> {
  const userIdHash = ethers.id(uid);
  try {
    const tx = await contract.getFunction('setUserStatus')(userIdHash, MEMBER_STATUS_INACTIVE);
    const receipt = await tx.wait();
    return `deactivated (block ${receipt.blockNumber})`;
  } catch (err) {
    const message = (err as { message?: string }).message ?? '';
    if (message.includes('User not registered')) return 'skipped (never registered on-chain)';
    if (message.includes('Already this status')) return 'skipped (already inactive)';
    throw err;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Belrose: Purge stale e2e dependent accounts     ');
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN (pass --execute to write)' : '🚀 LIVE'}`);
  console.log('═══════════════════════════════════════════════════\n');

  const contract = DRY_RUN ? null : getContract();

  const snapshot = await db.collection('users').where('firstName', 'in', ['Little', 'Switchy']).get();
  console.log(`📦 Found ${snapshot.size} stale dependent docs\n`);

  const results = { purged: 0, failed: 0 };

  for (const userDoc of snapshot.docs) {
    const uid = userDoc.id;
    const displayName = userDoc.data().displayName;
    console.log(`👤 ${uid} (${displayName})`);

    if (DRY_RUN) {
      console.log(`   🧪 would deactivate on-chain, delete Auth user, delete Firestore doc\n`);
      continue;
    }

    try {
      const chainResult = await deactivateOnChain(contract!, uid);
      console.log(`   ⛓️  ${chainResult}`);

      await auth.deleteUser(uid).catch(err => {
        if (err.code !== 'auth/user-not-found') throw err;
      });
      console.log(`   🔑 Auth user deleted`);

      await userDoc.ref.delete();
      console.log(`   📝 Firestore doc deleted\n`);

      results.purged++;
    } catch (err) {
      console.error(`   ❌ Failed:`, err);
      results.failed++;
    }
  }

  console.log('═══════════════════════════════════════════════════');
  console.log(`   ✅ Purged: ${results.purged}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

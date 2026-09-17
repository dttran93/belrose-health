// scripts/upgradeHealthRecordCore.js
import hre from 'hardhat';
import { HEALTH_RECORD_CORE, MEMBER_ROLE_MANAGER } from './_shared/blockchainAddresses.core.js';
const { ethers, upgrades } = hre;

const HEALTH_RECORD_CORE_PROXY = HEALTH_RECORD_CORE.proxy;
const MEMBER_ROLE_MANAGER_PROXY = MEMBER_ROLE_MANAGER.proxy;

async function main() {
  console.log('🚀 Starting HealthRecordCore upgrade...');
  console.log('📍 Proxy address (will not change):', HEALTH_RECORD_CORE_PROXY);

  // RPC sanity check
  const network = await ethers.provider.getNetwork();
  console.log('🔗 Connected to chain ID:', network.chainId.toString(), '(expected: 84532 for Base Sepolia)');
  const code = await ethers.provider.getCode(HEALTH_RECORD_CORE_PROXY);
  console.log('📦 Bytecode at proxy:', code === '0x' ? 'EMPTY ❌ (contract not found)' : `OK ✅ (${code.length / 2 - 1} bytes)`);

  const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  const raw = await ethers.provider.getStorage(HEALTH_RECORD_CORE_PROXY, slot);
  const oldImplAddress = '0x' + raw.slice(-40);
  console.log('📍 Current implementation address (Will be changed):', oldImplAddress);

  const HealthRecordCoreV2 = await ethers.getContractFactory('HealthRecordCore');

  // forceImport registers the existing on-chain proxy in the local OZ manifest so
  // upgradeProxy can verify storage layout compatibility before deploying — needed because the
  // manifest is local to this machine and may not already have this proxy registered.
  console.log('\n📋 Registering existing proxy in local manifest...');
  await upgrades.forceImport(HEALTH_RECORD_CORE_PROXY, HealthRecordCoreV2, { kind: 'uups' });
  console.log('✅ Proxy registered');

  console.log('\n📦 Deploying new implementation...');
  const upgraded = await upgrades.upgradeProxy(HEALTH_RECORD_CORE_PROXY, HealthRecordCoreV2, {
    kind: 'uups',
    redeployImplementation: 'always',
  });
  await upgraded.waitForDeployment();

  // Poll until the storage slot reflects the new implementation — a single read right after
  // waitForDeployment() can still return the OLD address (RPC node lag), same issue documented
  // and worked around in upgradeMemberRoleManager.js. Confirmed live during the #816/#820 deploy:
  // the immediate read returned the pre-upgrade address even though the upgrade had genuinely
  // succeeded on-chain.
  console.log('⏳ Waiting for RPC to reflect new implementation...');
  let newImplAddress = '';
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const newRaw = await ethers.provider.getStorage(HEALTH_RECORD_CORE_PROXY, slot);
    newImplAddress = '0x' + newRaw.slice(-40);
    console.log(`   Attempt ${i + 1}: ${newImplAddress}`);
    if (newImplAddress.toLowerCase() !== oldImplAddress.toLowerCase()) break;
  }

  console.log('✅ Proxy upgraded successfully!');
  console.log('📍 Proxy address (unchanged):', await upgraded.getAddress());
  console.log('📍 New implementation address:', newImplAddress);

  // Verify MemberRoleManager reference
  console.log('\n🔍 Verifying MemberRoleManager reference...');
  const currentMRM = await upgraded.memberRoleManager();
  console.log('📍 Current MemberRoleManager:', currentMRM);

  if (currentMRM.toLowerCase() !== MEMBER_ROLE_MANAGER_PROXY.toLowerCase()) {
    console.log('⚠️  MemberRoleManager mismatch! Updating...');
    const tx = await upgraded.setMemberRoleManager(MEMBER_ROLE_MANAGER_PROXY);
    await tx.wait();
    console.log('✅ MemberRoleManager updated. Tx:', tx.hash);
  } else {
    console.log('✅ MemberRoleManager reference is correct — no update needed.');
  }

  console.log('\n📝 ACTION REQUIRED — update blockchainAddresses.ts:');
  console.log(`   implementation: '${newImplAddress}',`);
  console.log('   (proxy address stays the same — no frontend changes needed)');
  console.log(
    `\n📝 ACTION REQUIRED — verify on network: npx hardhat verify --network baseSepolia '${newImplAddress}'`
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

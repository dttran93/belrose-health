// src/config/blockchainAddresses.core.ts
//
// Single source of truth for deployed contract/infrastructure addresses.
// Deliberately dependency-free (no viem, no frontend/functions-only imports) so
// that non-Node-workspace consumers — currently the Hardhat `contracts/` project —
// can compile just this file standalone via `npm run copy-shared`.
//
// IMPORTANT: When redeploying any contract, update the relevant address here.
// All services, hooks, and scripts should import from this file (or from
// blockchainAddresses.ts, which re-exports it) rather than hardcoding addresses locally.
//
// ============================================================================
// NETWORK INFRASTRUCTURE
// ============================================================================
export const NETWORK_CORE = {
    chainId: 84532,
    name: 'base-sepolia',
    rpcUrlFallback: 'https://base-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.basescan.org/',
};
//Has to be built in front/backend because it requires different apiKeys
export function buildRpcUrl(apiKey) {
    return `https://base-sepolia.g.alchemy.com/v2/${apiKey}`;
}
// ============================================================================
// ERC-4337 ACCOUNT ABSTRACTION INFRASTRUCTURE
// ============================================================================
export const AA_INFRASTRUCTURE = {
    // Canonical ERC-4337 v0.7 EntryPoint (same address on all chains)
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
};
// ============================================================================
// BELROSE PAYMASTER (BelrosePaymaster.sol)
// Not upgradeable — proxy/implementation distinction does not apply
// ============================================================================
export const PAYMASTER = {
    address: '0x02422f03EcD403E1a902101D60a0Dad5bB9E71a7',
    dailySponsorLimit: 100, // Max sponsored txs per user per day. Set high so we can test in dev. Change in future
};
export function buildBundlerURL(pimlicoApiKey) {
    return `https://api.pimlico.io/v2/${NETWORK_CORE.chainId}/rpc?apikey=${pimlicoApiKey}`;
}
// ============================================================================
// MEMBER ROLE MANAGER (MemberRoleManager.sol)
// UUPS upgradeable proxy — always interact via proxy address
// ============================================================================
export const MEMBER_ROLE_MANAGER = {
    proxy: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
    implementation: '0x88a7a3822c8033ae126c762a40c280e89024a1ac',
    deploymentBlock: 43657997,
};
// ============================================================================
// HEALTH RECORD CORE (HealthRecordCore.sol)
// UUPS upgradeable proxy — always interact via proxy address
// ============================================================================
export const HEALTH_RECORD_CORE = {
    proxy: '0xE1012A0D698cced489C47189F9DC9372d6Fb104B',
    implementation: '0x4f6C255F4B433692364e424e2BDeC78ADe7c10fd',
    deploymentBlock: 43657997,
};
// ============================================================================
// CONVENIENCE ALIASES
// For files that just need a single address with a simple import
// ============================================================================
export const CONTRACT_ADDRESSES = {
    paymaster: PAYMASTER.address,
    memberRoleManager: MEMBER_ROLE_MANAGER.proxy,
    healthRecordCore: HEALTH_RECORD_CORE.proxy,
    entryPoint: AA_INFRASTRUCTURE.entryPoint,
};
export function buildBlockchainRef(txHash, blockNumber, contractAddress) {
    return {
        txHash,
        chainId: NETWORK_CORE.chainId,
        blockNumber,
        contractAddress,
    };
}
// Pre-bound helpers for each contract — chainId is always pulled from NETWORK_CORE
export const buildMemberRegistryRef = (txHash, blockNumber) => buildBlockchainRef(txHash, blockNumber, MEMBER_ROLE_MANAGER.proxy);
export const buildHealthRecordRef = (txHash, blockNumber) => buildBlockchainRef(txHash, blockNumber, HEALTH_RECORD_CORE.proxy);

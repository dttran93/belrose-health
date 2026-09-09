"use strict";
// functions/src/utils/adminWallet.ts
//
// The permanent server-held signer used by the small set of admin-only on-chain writes
// (member registration/status, first-role initialization, dependent-account bootstrap,
// unaccepted-flag actions) — the on-chain `admin` address on both MemberRoleManager and
// HealthRecordCore. Extracted from memberRegistry.ts/unacceptedFlags.ts/createDependentAccount.ts,
// which each carried a byte-identical copy of this function.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminWallet = getAdminWallet;
const ethers_1 = require("ethers");
const _shared_1 = require("../_shared/");
function getAdminWallet() {
    const privateKey = process.env.ADMIN_WALLET_PRIVATE_KEY;
    const rpcUrl = process.env.RPC_URL || _shared_1.NETWORK.rpcUrlFallback;
    if (!privateKey)
        throw new Error('Admin wallet private key not found');
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
    return new ethers_1.ethers.Wallet(privateKey, provider);
}
//# sourceMappingURL=adminWallet.js.map
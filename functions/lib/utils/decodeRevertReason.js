"use strict";
// functions/src/utils/decodeRevertReason.ts
//
// Decodes a standard Error(string) ABI revert: selector 0x08c379a0 + ABI-encoded string.
// Duplicated from src/features/BlockchainWallet/services/blockchainSyncQueueService.ts's
// identical helper — that file lives in src/, which functions/ has no dependency on, and this
// is a small, pure, dependency-free function (no ethers/firebase), so a local copy here
// matches this codebase's existing convention of duplicating small cross-boundary helpers
// (see getAdminWallet's history in utils/adminWallet.ts) rather than adding new shared-package
// plumbing for one function.
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeRevertReason = decodeRevertReason;
function decodeRevertReason(error) {
    const data = error.match(/0x08c379a0([0-9a-f]+)/i)?.[1];
    if (!data || data.length < 128)
        return null;
    try {
        const length = parseInt(data.slice(64, 128), 16);
        if (length === 0 || length > 1024)
            return null;
        const stringHex = data.slice(128, 128 + length * 2);
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = parseInt(stringHex.slice(i * 2, i * 2 + 2), 16);
        }
        return new TextDecoder().decode(bytes);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=decodeRevertReason.js.map
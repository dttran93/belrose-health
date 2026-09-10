"use strict";
// functions/src/handlers/blockchainSyncRetry.ts
//
// Admin-only callable to retry a blockchainSyncQueue entry. Named adminRetryBlockchainSync
// (not just retryBlockchainSync) to stay unambiguous against a future, separate user-facing
// retry mechanism for the client-orchestrated sync-queue entries this one can't touch — see
// blockchainSyncRetryService.ts's header for the full split.
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRetryBlockchainSync = void 0;
const https_1 = require("firebase-functions/v2/https");
const blockchainSyncRetryService_1 = require("../services/blockchainSyncRetryService");
exports.adminRetryBlockchainSync = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth?.token?.platformAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Not authorized');
    }
    const docId = request.data?.docId;
    if (!docId || typeof docId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'docId is required');
    }
    return (0, blockchainSyncRetryService_1.executeReplay)(docId, request.auth.uid);
});
//# sourceMappingURL=blockchainSyncRetry.js.map
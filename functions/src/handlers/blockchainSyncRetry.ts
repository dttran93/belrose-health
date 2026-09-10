// functions/src/handlers/blockchainSyncRetry.ts
//
// Admin-only callable to retry a blockchainSyncQueue entry. Named adminRetryBlockchainSync
// (not just retryBlockchainSync) to stay unambiguous against a future, separate user-facing
// retry mechanism for the client-orchestrated sync-queue entries this one can't touch — see
// blockchainSyncRetryService.ts's header for the full split.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { executeReplay } from '../services/blockchainSyncRetryService';

export const adminRetryBlockchainSync = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth?.token?.platformAdmin) {
      throw new HttpsError('permission-denied', 'Not authorized');
    }

    const docId = request.data?.docId;
    if (!docId || typeof docId !== 'string') {
      throw new HttpsError('invalid-argument', 'docId is required');
    }

    return executeReplay(docId, request.auth.uid);
  }
);

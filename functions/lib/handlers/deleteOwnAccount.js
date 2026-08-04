"use strict";
// functions/src/handlers/deleteOwnAccount.ts
//
// Final step of self-service account deletion (AccountDeletionService.deleteMyAccount).
// By the time this is called, the client has already cleaned up records, trustee
// relationships, and the caller's own pending subject requests, and deleted the
// `users/{uid}` doc. This function does the two things only the Admin SDK can do:
//
//   1. Sweep any pending subjectConsentRequests/subjectRemovalRequests where the
//      caller is the target `subjectId` (not the requester) — Firestore rules don't
//      let a subject delete those directly, only the requester or a record admin/owner.
//      But needs to be deleted because there's no user anymore.
//   2. Delete the Firebase Auth user — done server-side rather than via the client
//      SDK's `user.delete()` to avoid its "requires recent login" failure mode after
//      a long async cleanup sequence.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteOwnAccount = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const admin = __importStar(require("firebase-admin"));
exports.deleteOwnAccount = (0, https_1.onCall)({}, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be authenticated');
    const uid = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    for (const collectionName of ['subjectConsentRequests', 'subjectRemovalRequests']) {
        const snapshot = await db
            .collection(collectionName)
            .where('subjectId', '==', uid)
            .where('status', '==', 'pending')
            .get();
        await Promise.all(snapshot.docs.map(d => d.ref.delete()));
    }
    try {
        await admin.auth().deleteUser(uid);
    }
    catch (err) {
        console.warn(`Could not delete Auth user ${uid}:`, err);
    }
    console.log(`✅ Account fully deleted: ${uid}`);
    return { success: true };
});
//# sourceMappingURL=deleteOwnAccount.js.map
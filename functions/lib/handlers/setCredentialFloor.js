"use strict";
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
exports.setCredentialFloor = void 0;
// functions/src/handlers/setCredentialFloor.ts
//
// Admin-only: sets a user's CredentialFloor — the whitepaper's pre-trusted-set input to
// EarnedTrust(u) = max(CredentialFloor(u), AvgRecordCredibility(u) + DisputeAccuracy(u) - CulpabilityPenalty(u)).
// Mirrors setAdminClaim.ts's gated-callable pattern exactly, minus the custom Auth claim —
// credentialFloor isn't used for rules-gated authorization, it's purely a data input read
// server-side by the (not-yet-built) UserCredibility batch computation.
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
exports.setCredentialFloor = (0, https_1.onCall)(async (request) => {
    // Gate: only platform admins can set this
    if (!request.auth?.token?.platformAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Not authorized');
    }
    const { uid, credentialFloor } = request.data;
    if (!uid || typeof uid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'A valid uid is required');
    }
    if (typeof credentialFloor !== 'number' || credentialFloor < 0 || credentialFloor > 1000) {
        throw new https_1.HttpsError('invalid-argument', 'credentialFloor must be a number between 0 and 1000');
    }
    await admin.firestore().collection('users').doc(uid).update({ credentialFloor });
    return { success: true };
});
//# sourceMappingURL=setCredentialFloor.js.map
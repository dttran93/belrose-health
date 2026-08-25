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
exports.getSponsorshipStatus = exports.signSponsorship = exports.onRecordRequestUpdated = exports.onRecordRequestCreated = exports.onTrusteeRelationshipUpdated = exports.onTrusteeRelationshipCreated = exports.onDisputeUpdated = exports.onDisputeWritten = exports.onVerificationUpdated = exports.onVerificationWritten = exports.onPermissionChangeEventCreated = exports.onSubjectConsentRequestUpdated = exports.onSubjectConsentRequestCreated = exports.onRecordDeletionEventCreated = exports.onRecordVersionCreated = exports.initializeRoleOnChainForRequester = exports.initializeRoleOnChain = exports.reactivateWalletOnChain = exports.deactivateWalletOnChain = exports.updateMemberStatus = exports.registerMemberOnChainComplete = exports.registerMemberOnChain = exports.healthDetailed = exports.health = exports.guestPasswordUpdate = exports.createRecordRequest = exports.redeemGuestInvite = exports.createGuestInvite = exports.initiateHandoff = exports.claimDependentAccount = exports.switchToGuardian = exports.switchToDependent = exports.createDependentAccount = exports.deleteOwnAccount = exports.addToMailingList = exports.sendPasswordChangeEmail = exports.sendWaitlistConfirmationEmail = exports.sendAlphaApprovalEmail = exports.sendShareInvitationEmail = exports.getEncryptedWallet = exports.createEOAWallet = exports.createBelroseFields = exports.convertToFHIR = exports.analyzeImageWithAI = exports.revokeUnacceptedFlag = exports.flagUnacceptedUpdate = exports.recomputeUserCredibility = exports.runUserCredibilityBatch = exports.setCredentialFloor = exports.setPlatformAdmin = void 0;
exports.stripeIdentityWebhook = exports.getStripeSessionStatus = exports.createStripeVerificationSession = exports.refineRecord = exports.checkEmailRegistrationStatus = exports.aiChat = void 0;
// functions/src/index.ts
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
// ==================== ADMIN FUNCTIONS ====================
var setAdminClaim_1 = require("./handlers/setAdminClaim");
Object.defineProperty(exports, "setPlatformAdmin", { enumerable: true, get: function () { return setAdminClaim_1.setPlatformAdmin; } });
var setCredentialFloor_1 = require("./handlers/setCredentialFloor");
Object.defineProperty(exports, "setCredentialFloor", { enumerable: true, get: function () { return setCredentialFloor_1.setCredentialFloor; } });
// ==================== USER CREDIBILITY BATCH ====================
var userCredibilityBatch_1 = require("./handlers/userCredibilityBatch");
Object.defineProperty(exports, "runUserCredibilityBatch", { enumerable: true, get: function () { return userCredibilityBatch_1.runUserCredibilityBatch; } });
Object.defineProperty(exports, "recomputeUserCredibility", { enumerable: true, get: function () { return userCredibilityBatch_1.recomputeUserCredibility; } });
var unacceptedFlags_1 = require("./handlers/unacceptedFlags");
Object.defineProperty(exports, "flagUnacceptedUpdate", { enumerable: true, get: function () { return unacceptedFlags_1.flagUnacceptedUpdate; } });
Object.defineProperty(exports, "revokeUnacceptedFlag", { enumerable: true, get: function () { return unacceptedFlags_1.revokeUnacceptedFlag; } });
// ==================== IMAGE ANALYSIS FUNCTIONS ====================
var image_1 = require("./handlers/image");
Object.defineProperty(exports, "analyzeImageWithAI", { enumerable: true, get: function () { return image_1.analyzeImageWithAI; } });
// ==================== MEDICAL DATA PROCESSING FUNCTIONS ====================
var convertToFHIR_1 = require("./handlers/convertToFHIR");
Object.defineProperty(exports, "convertToFHIR", { enumerable: true, get: function () { return convertToFHIR_1.convertToFHIR; } });
var belroseFields_1 = require("./handlers/belroseFields");
Object.defineProperty(exports, "createBelroseFields", { enumerable: true, get: function () { return belroseFields_1.createBelroseFields; } });
// ==================== WALLET FUNCTIONS ====================
var wallet_1 = require("./handlers/wallet");
Object.defineProperty(exports, "createEOAWallet", { enumerable: true, get: function () { return wallet_1.createEOAWallet; } });
Object.defineProperty(exports, "getEncryptedWallet", { enumerable: true, get: function () { return wallet_1.getEncryptedWallet; } });
// ==================== EMAIL FUNCTIONS ====================
var sendShareInvitationEmail_1 = require("./handlers/sendShareInvitationEmail");
Object.defineProperty(exports, "sendShareInvitationEmail", { enumerable: true, get: function () { return sendShareInvitationEmail_1.sendShareInvitationEmail; } });
var sendAlphaApprovalEmail_1 = require("./handlers/sendAlphaApprovalEmail");
Object.defineProperty(exports, "sendAlphaApprovalEmail", { enumerable: true, get: function () { return sendAlphaApprovalEmail_1.sendAlphaApprovalEmail; } });
var sendWaitlistConfirmationEmail_1 = require("./handlers/sendWaitlistConfirmationEmail");
Object.defineProperty(exports, "sendWaitlistConfirmationEmail", { enumerable: true, get: function () { return sendWaitlistConfirmationEmail_1.sendWaitlistConfirmationEmail; } });
var sendPasswordChangeEmail_1 = require("./handlers/sendPasswordChangeEmail");
Object.defineProperty(exports, "sendPasswordChangeEmail", { enumerable: true, get: function () { return sendPasswordChangeEmail_1.sendPasswordChangeEmail; } });
var addToMailingList_1 = require("./handlers/addToMailingList");
Object.defineProperty(exports, "addToMailingList", { enumerable: true, get: function () { return addToMailingList_1.addToMailingList; } });
// ==================== ACCOUNT DELETION ====================
var deleteOwnAccount_1 = require("./handlers/deleteOwnAccount");
Object.defineProperty(exports, "deleteOwnAccount", { enumerable: true, get: function () { return deleteOwnAccount_1.deleteOwnAccount; } });
// ==================== DEPENDENT ACCOUNTS ====================
var createDependentAccount_1 = require("./handlers/createDependentAccount");
Object.defineProperty(exports, "createDependentAccount", { enumerable: true, get: function () { return createDependentAccount_1.createDependentAccount; } });
var switchAccount_1 = require("./handlers/switchAccount");
Object.defineProperty(exports, "switchToDependent", { enumerable: true, get: function () { return switchAccount_1.switchToDependent; } });
Object.defineProperty(exports, "switchToGuardian", { enumerable: true, get: function () { return switchAccount_1.switchToGuardian; } });
var claimDependentAccount_1 = require("./handlers/claimDependentAccount");
Object.defineProperty(exports, "claimDependentAccount", { enumerable: true, get: function () { return claimDependentAccount_1.claimDependentAccount; } });
var initiateHandoff_1 = require("./handlers/initiateHandoff");
Object.defineProperty(exports, "initiateHandoff", { enumerable: true, get: function () { return initiateHandoff_1.initiateHandoff; } });
// ==================== GUEST INVITE ====================
var createGuestInvite_1 = require("./handlers/createGuestInvite");
Object.defineProperty(exports, "createGuestInvite", { enumerable: true, get: function () { return createGuestInvite_1.createGuestInvite; } });
var redeemGuestInvite_1 = require("./handlers/redeemGuestInvite");
Object.defineProperty(exports, "redeemGuestInvite", { enumerable: true, get: function () { return redeemGuestInvite_1.redeemGuestInvite; } });
var createRecordRequest_1 = require("./handlers/createRecordRequest");
Object.defineProperty(exports, "createRecordRequest", { enumerable: true, get: function () { return createRecordRequest_1.createRecordRequest; } });
var guestPasswordUpdate_1 = require("./handlers/guestPasswordUpdate");
Object.defineProperty(exports, "guestPasswordUpdate", { enumerable: true, get: function () { return guestPasswordUpdate_1.guestPasswordUpdate; } });
// ==================== HEALTH CHECK ====================
var healthCheck_1 = require("./handlers/healthCheck");
Object.defineProperty(exports, "health", { enumerable: true, get: function () { return healthCheck_1.health; } });
Object.defineProperty(exports, "healthDetailed", { enumerable: true, get: function () { return healthCheck_1.healthDetailed; } });
// ==================== MEMBER REGISTRY ====================
var memberRegistry_1 = require("./handlers/memberRegistry");
Object.defineProperty(exports, "registerMemberOnChain", { enumerable: true, get: function () { return memberRegistry_1.registerMemberOnChain; } });
Object.defineProperty(exports, "registerMemberOnChainComplete", { enumerable: true, get: function () { return memberRegistry_1.registerMemberOnChainComplete; } });
Object.defineProperty(exports, "updateMemberStatus", { enumerable: true, get: function () { return memberRegistry_1.updateMemberStatus; } });
Object.defineProperty(exports, "deactivateWalletOnChain", { enumerable: true, get: function () { return memberRegistry_1.deactivateWalletOnChain; } });
Object.defineProperty(exports, "reactivateWalletOnChain", { enumerable: true, get: function () { return memberRegistry_1.reactivateWalletOnChain; } });
Object.defineProperty(exports, "initializeRoleOnChain", { enumerable: true, get: function () { return memberRegistry_1.initializeRoleOnChain; } });
Object.defineProperty(exports, "initializeRoleOnChainForRequester", { enumerable: true, get: function () { return memberRegistry_1.initializeRoleOnChainForRequester; } });
// ==================== NOTIFICATIONS ====================
var recordEditNotificationTrigger_1 = require("./notifications/triggers/recordEditNotificationTrigger");
Object.defineProperty(exports, "onRecordVersionCreated", { enumerable: true, get: function () { return recordEditNotificationTrigger_1.onRecordVersionCreated; } });
var deleteRecordNotificationTrigger_1 = require("./notifications/triggers/deleteRecordNotificationTrigger");
Object.defineProperty(exports, "onRecordDeletionEventCreated", { enumerable: true, get: function () { return deleteRecordNotificationTrigger_1.onRecordDeletionEventCreated; } });
var subjectNotificationTrigger_1 = require("./notifications/triggers/subjectNotificationTrigger");
Object.defineProperty(exports, "onSubjectConsentRequestCreated", { enumerable: true, get: function () { return subjectNotificationTrigger_1.onSubjectConsentRequestCreated; } });
Object.defineProperty(exports, "onSubjectConsentRequestUpdated", { enumerable: true, get: function () { return subjectNotificationTrigger_1.onSubjectConsentRequestUpdated; } });
var permissionNotificationTrigger_1 = require("./notifications/triggers/permissionNotificationTrigger");
Object.defineProperty(exports, "onPermissionChangeEventCreated", { enumerable: true, get: function () { return permissionNotificationTrigger_1.onPermissionChangeEventCreated; } });
var credibilityNotificationTrigger_1 = require("./notifications/triggers/credibilityNotificationTrigger");
Object.defineProperty(exports, "onVerificationWritten", { enumerable: true, get: function () { return credibilityNotificationTrigger_1.onVerificationWritten; } });
Object.defineProperty(exports, "onVerificationUpdated", { enumerable: true, get: function () { return credibilityNotificationTrigger_1.onVerificationUpdated; } });
Object.defineProperty(exports, "onDisputeWritten", { enumerable: true, get: function () { return credibilityNotificationTrigger_1.onDisputeWritten; } });
Object.defineProperty(exports, "onDisputeUpdated", { enumerable: true, get: function () { return credibilityNotificationTrigger_1.onDisputeUpdated; } });
var trusteeNotificationTriggers_1 = require("./notifications/triggers/trusteeNotificationTriggers");
Object.defineProperty(exports, "onTrusteeRelationshipCreated", { enumerable: true, get: function () { return trusteeNotificationTriggers_1.onTrusteeRelationshipCreated; } });
Object.defineProperty(exports, "onTrusteeRelationshipUpdated", { enumerable: true, get: function () { return trusteeNotificationTriggers_1.onTrusteeRelationshipUpdated; } });
var requestRecordNotificationTrigger_1 = require("./notifications/triggers/requestRecordNotificationTrigger");
Object.defineProperty(exports, "onRecordRequestCreated", { enumerable: true, get: function () { return requestRecordNotificationTrigger_1.onRecordRequestCreated; } });
Object.defineProperty(exports, "onRecordRequestUpdated", { enumerable: true, get: function () { return requestRecordNotificationTrigger_1.onRecordRequestUpdated; } });
// ==================== PAYMASTER ====================
var paymaster_1 = require("./handlers/paymaster");
Object.defineProperty(exports, "signSponsorship", { enumerable: true, get: function () { return paymaster_1.signSponsorship; } });
Object.defineProperty(exports, "getSponsorshipStatus", { enumerable: true, get: function () { return paymaster_1.getSponsorshipStatus; } });
// ==================== AI CHAT FUNCTIONS ====================
var aiChat_1 = require("./handlers/aiChat");
Object.defineProperty(exports, "aiChat", { enumerable: true, get: function () { return aiChat_1.aiChat; } });
// ==================== COLLECTION QUERY FUNCTIONS =====================
var checkEmailRegistrationStatus_1 = require("./handlers/checkEmailRegistrationStatus");
Object.defineProperty(exports, "checkEmailRegistrationStatus", { enumerable: true, get: function () { return checkEmailRegistrationStatus_1.checkEmailRegistrationStatus; } });
// ==================== RECORD REFINEMENT FUNCTIONS ====================
var refineRecord_1 = require("./handlers/refineRecord");
Object.defineProperty(exports, "refineRecord", { enumerable: true, get: function () { return refineRecord_1.refineRecord; } });
// ==================== IDENTITY VERIFICATION ====================
var stripeIdentity_1 = require("./handlers/stripeIdentity");
Object.defineProperty(exports, "createStripeVerificationSession", { enumerable: true, get: function () { return stripeIdentity_1.createStripeVerificationSession; } });
Object.defineProperty(exports, "getStripeSessionStatus", { enumerable: true, get: function () { return stripeIdentity_1.getStripeSessionStatus; } });
Object.defineProperty(exports, "stripeIdentityWebhook", { enumerable: true, get: function () { return stripeIdentity_1.stripeIdentityWebhook; } });
//# sourceMappingURL=index.js.map
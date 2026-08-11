// functions/src/index.ts
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// ==================== ADMIN FUNCTIONS ====================
export { setPlatformAdmin } from './handlers/setAdminClaim';
export { setCredentialFloor } from './handlers/setCredentialFloor';

// ==================== IMAGE ANALYSIS FUNCTIONS ====================
export { analyzeImageWithAI } from './handlers/image';

// ==================== MEDICAL DATA PROCESSING FUNCTIONS ====================
export { convertToFHIR } from './handlers/convertToFHIR';
export { createBelroseFields } from './handlers/belroseFields';

// ==================== WALLET FUNCTIONS ====================
export { createEOAWallet, getEncryptedWallet } from './handlers/wallet';

// ==================== EMAIL FUNCTIONS ====================
export { sendShareInvitationEmail } from './handlers/sendShareInvitationEmail';
export { sendAlphaApprovalEmail } from './handlers/sendAlphaApprovalEmail';
export { sendWaitlistConfirmationEmail } from './handlers/sendWaitlistConfirmationEmail';
export { sendPasswordChangeEmail } from './handlers/sendPasswordChangeEmail';
export { addToMailingList } from './handlers/addToMailingList';

// ==================== ACCOUNT DELETION ====================
export { deleteOwnAccount } from './handlers/deleteOwnAccount';

// ==================== DEPENDENT ACCOUNTS ====================
export { createDependentAccount } from './handlers/createDependentAccount';
export { switchToDependent, switchToGuardian } from './handlers/switchAccount';
export { claimDependentAccount } from './handlers/claimDependentAccount';
export { initiateHandoff } from './handlers/initiateHandoff';

// ==================== GUEST INVITE ====================
export { createGuestInvite } from './handlers/createGuestInvite';
export { redeemGuestInvite } from './handlers/redeemGuestInvite';
export { createRecordRequest } from './handlers/createRecordRequest';
export { guestPasswordUpdate } from './handlers/guestPasswordUpdate';

// ==================== HEALTH CHECK ====================
export { health, healthDetailed } from './handlers/healthCheck';

// ==================== MEMBER REGISTRY ====================
export {
  registerMemberOnChain,
  registerMemberOnChainComplete,
  updateMemberStatus,
  deactivateWalletOnChain,
  reactivateWalletOnChain,
  initializeRoleOnChain,
  initializeRoleOnChainForRequester,
} from './handlers/memberRegistry';

// ==================== NOTIFICATIONS ====================
export { onRecordVersionCreated } from './notifications/triggers/recordEditNotificationTrigger';

export { onRecordDeletionEventCreated } from './notifications/triggers/deleteRecordNotificationTrigger';

export {
  onSubjectConsentRequestCreated,
  onSubjectConsentRequestUpdated,
} from './notifications/triggers/subjectNotificationTrigger';

export { onPermissionChangeEventCreated } from './notifications/triggers/permissionNotificationTrigger';

export {
  onVerificationWritten,
  onVerificationUpdated,
  onDisputeWritten,
  onDisputeUpdated,
} from './notifications/triggers/credibilityNotificationTrigger';

export {
  onTrusteeRelationshipCreated,
  onTrusteeRelationshipUpdated,
} from './notifications/triggers/trusteeNotificationTriggers';

export {
  onRecordRequestCreated,
  onRecordRequestUpdated,
} from './notifications/triggers/requestRecordNotificationTrigger';

// ==================== PAYMASTER ====================
export { signSponsorship, getSponsorshipStatus } from './handlers/paymaster';

// ==================== AI CHAT FUNCTIONS ====================
export { aiChat } from './handlers/aiChat';

// ==================== COLLECTION QUERY FUNCTIONS =====================
export { checkEmailRegistrationStatus } from './handlers/checkEmailRegistrationStatus';

// ==================== RECORD REFINEMENT FUNCTIONS ====================
export { refineRecord } from './handlers/refineRecord';

// ==================== IDENTITY VERIFICATION ====================
export {
  createStripeVerificationSession,
  getStripeSessionStatus,
  stripeIdentityWebhook,
} from './handlers/stripeIdentity';

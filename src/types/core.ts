import { BelroseFields, BlockchainRef, NotificationPrefs, UserCredibilityScore } from '@belrose/shared';
import { Timestamp } from 'firebase/firestore';
import { ReactNode } from 'react';

// ==================== USER & AUTHENTICATION ====================

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  photoURL?: string | null;
  notificationPrefs?: NotificationPrefs;

  encryption: {
    enabled: boolean;
    encryptedMasterKey: string;
    masterKeyIV: string;
    masterKeySalt: string;
    recoveryKeyHash: string; // for recovery key verification
    setupAt: string;
    lastUnlockedAt?: string; // track usage

    // RSA Sharing Keys (used for sharing and unwrapping shared file keys)
    encryptedPrivateKey: string; // The encrypted RSA Private Key (encrypted by Master Key)
    encryptedPrivateKeyIV: string; // The IV for the encrypted RSA Private Key
    publicKey: string; // The RSA Public Key
  };
}

export interface BelroseUserProfile extends User {
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  wallet: UserWallet;
  emailVerified: boolean;
  emailVerifiedAt?: Timestamp | null;
  identityVerified: boolean;
  identityVerifiedAt?: Timestamp | null;
  healthcareProviderVerified?: boolean; //if Belrose has verified they are a certified healthcare provider
  healthcareProviderVerifiedAt?: Timestamp; //if Belrose has verified they are a certified healthcare provider
  // Fully server-computed by the batch UserCredibility job — richer than records' CredibilityScore
  // since it carries the EarnedTrust breakdown, not just the final score. Never client-written.
  credibility?: UserCredibilityScore;
  // Admin-set input to EarnedTrust's CredentialFloor term (whitepaper's pre-trusted set). Separate
  // from `credibility` (a rarely-changing input vs. a wholesale-overwritten computed output) —
  // settable only via the setCredentialFloor admin callable, never by the user themselves.
  credentialFloor?: number;
  isGuest?: boolean; //For guest accounts
  isPlatformAdmin?: boolean; // For platform admin privileges
  isDependent?: boolean; // Account created by a guardian on behalf of someone else
  dependentCreatedBy?: string; // UID of the guardian who created this account
  handoffInitiatedAt?: Timestamp | null; // Set when the guardian sends the "claim your account" email
  signInProvider?: string; // Firebase sign-in provider for current session ('password', 'custom', etc.)
  passwordSelfSetAt?: string; // ISO timestamp of when the user last set their own password via recovery flow

  onChainIdentity?: {
    userIdHash: string; // The keccak256 hash of the UID. Intentionally not a search path for users. Want to maintain privacy separation between on-chain/off-chain identities.
    onChainStatus: onChainIdentityStatus[]; // Log of history of on-chain status changes for this identity
    linkedWallets: LinkedWalletRecord[]; // The collection of all linked wallets to this identity on the contract
  };

  //Other Info
  affiliations?: [string] | [];
  searchDiscoverable?: boolean; // defaults to absent. Privacy setting. Controls whether this user appears in email/name searches. Exact UID/email lookups work because that requires the searcher to know the person
  displayNameLower?: string; //For name search purposes
}

// ==================== WALLET TYPES ====================
export type WalletOrigin = 'generated' | 'metamask' | 'walletconnect' | 'hardware';

export interface UserWallet {
  address: string;
  origin: WalletOrigin;
  smartAccountAddress?: string; //Smart account used for account abstraction and gasless payments

  // Only present for generated wallets (Belrose stores encrypted keys)
  encryptedPrivateKey?: string;
  encryptedPrivateKeyIV?: string;
  keyAuthTag?: string;
  keySalt?: string;
  encryptedMnemonic?: string;
  mnemonicIv?: string;
  mnemonicAuthTag?: string;
  mnemonicSalt?: string;
}

/**
 * Represents a single wallet address linked to a user's on-chain identity
 */
export interface LinkedWalletRecord {
  address: string;
  type: 'eoa' | 'smart-account';
  blockchainRef: BlockchainRef;
  linkedAt: any; // Timestamp
  isWalletActive: boolean; // Reflects contract's isWalletActive status
  trusteeId?: string;
}

/**
 * Represents on-chain status of account overall (not just the wallet). Keeps an audit record of
 * any changes in on-chain status. Mirrors MemberRoleManager.sol's MemberStatus enum exactly —
 * there is no "Guest" status on-chain; guests are deliberately kept off the blockchain entirely
 * (see GuestClaimService's header comment).
 */
export interface onChainIdentityStatus {
  status: 'NotRegistered' | 'Inactive' | 'Active' | 'Verified' | 'VerifiedProvider'; //Practically NotRegistered will never happen, but technically its on chain so just here for completeness.
  statusUpdatedAt?: any;
  statusBlockchainRef?: BlockchainRef;
}

/**
 * Audit trail entry for a wrappedKeys/{recordId_userId} doc. Top-level fields on that doc
 * (isActive, grantedBy, revokedBy, etc.) always reflect only the MOST RECENT action of each kind —
 * some are also directly queried with `where()` (e.g. grantedBy in trusteePermissionService.ts) so
 * they can't be folded into this array. `history` exists purely so a key that's been through
 * multiple grant/revoke/reactivate cycles doesn't lose the intermediate events.
 */
export interface WrappedKeyHistoryEvent {
  action: 'granted' | 'revoked' | 'reactivated';
  by: string; // uid who performed the action
  at: Date;
}

// Authentication context data structure
export interface AuthContextData {
  user: BelroseUserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  refreshUser: () => {};
}

// ==================== HEALTH RECORDS FILE ====================

export interface RoleInitialization {
  blockchainInitialized: boolean;
  blockchainInitializedAt: Timestamp;
  blockchainRef: BlockchainRef;
  syncedFromChain: boolean; //For when an intialization had to be self-healed. Indicates there was an issue with updating firebase previously for future debugging/auditing
}

export interface CredibilityScore {
  score: number; //0-1000
  lastUpdated: Timestamp;
}

export type AIProcessingStatus =
  | 'pending' // AI processing not yet started
  | 'processing' // AI is currently processing
  | 'completed' // AI processing finished successfully
  | 'failed' // AI processing failed
  | 'not_needed'; // This record type doesn't need AI processing

export type FileStatus =
  | 'open' //waiting to upload
  | 'pending' // File uploaded, waiting to process
  | 'processing' // Currently being processed
  | 'uploading' // Currently uploading, use for making sure there aren't multiple uploads
  | 'completed' // Successfully processed
  | 'error'; // Failed with error

export type SourceType =
  | 'Plain Text Submission'
  | 'Manual FHIR JSON Submission'
  | 'File Upload'
  | 'Belrose Identity Form';

//Processing Stages good for the progress chips in the Add Record process
export type ProcessingStages =
  | 'Starting processing...'
  | 'Extracting text...'
  | 'Text extraction completed'
  | 'Converting to FHIR...'
  | 'FHIR conversion completed'
  | 'Completing...'
  | 'AI processing...'
  | 'AI analyzing content...'
  | 'Encrypting record data...'
  | 'Record encrypted'
  | 'Generating record hash...'
  | 'Uploading...'
  | undefined;

export interface VirtualFileInput {
  fileName?: string;
  sourceType?: SourceType;
  originalText?: string;
  fhirData?: any;
  wordCount?: number;
  [key: string]: any;
}

export interface FileObject {
  // === CORE IDENTIFICATION, (EXCLUDES FILE NAME, IN ENCRYPTED HEALTH DATA SECTION BELOW) ===
  id: string; //fileId. Generated in useFileManager via createFileObject() or addVirtualFile(). file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}
  firestoreId?: string; //Id for firestore set after upload
  recordIdHash?: string | null; // keccak256 of firestoreId used for on-chain lookup

  // === FILE PROPERTIES (EXCLUDES FILE, IN ENCRYPTED HEALTH DATA SECTION BELOW)===
  fileSize: number; //file size. Set in createFileObject in useFileManager.ts. file.size for real files
  fileType: string; //file type. Set in createFileObject in useFileManager.ts. file.type for real files or application/fhir+json for virtual - NEVER undefined
  wordCount?: number; //calculated during text extraction

  // === OWNERSHIP AND PERMISSIONS ===
  uploadedBy?: string; // User ID of who created/uploaded the record (for audit trail)
  owners?: string[]; // Array of user IDs with ultimate ownership access to record (read, update, delete, share)
  administrators: string[]; //Array of userIDs with administrative access to records, can't remove others
  viewers?: string[]; // Array of user IDs with view access to record
  sharers?: string[]; // Array of user IDs who can view and share the record (but not edit)
  subjects?: string[]; //The subject of this record. Made it an array for edge cases where there are multiple subjects (couples therapy, mother/newborn, family history, genetic testing)
  trustees?: string[]; // userIds who have access via an active trustee relationship

  // === PROCESSING STATUS ===
  status: FileStatus; //Processing property. Initially set as pending. Then pending/processing... see below
  error?: string; //Failed processing
  aiProcessingStatus?: AIProcessingStatus; //For Belrose Fields
  processingStage?: ProcessingStages;
  uploadInProgress?: boolean; // for managing upload process

  // === VERIFICATION AND SECURITY ===
  originalFileHash?: string | null; //hash of the original file that was uploaded
  recordHash?: string | null; //hash of the record content
  previousRecordHash?: string[] | null; //to establish chain of records in case they are edited
  blockchainRoleInitialization?: RoleInitialization;
  credibility?: CredibilityScore;

  // === METADATA ===
  sourceType?: SourceType;
  isVirtual?: boolean; //for virtual files
  downloadURL?: string;
  storagePath?: string;
  versionNumber?: string;

  // === TIMESTAMPS ===
  uploadedAt?: Timestamp;
  createdAt?: Timestamp;
  lastModified?: Timestamp; //Filetracking for UI state management.

  // PLAIN TEXT PERSONAL HEALTH DATA, MUST BE ENCRYPTED
  fileName: string; //file name or custom name for virtual files. set by createFileObject() in useFileManager.ts
  file?: File; //actual file object from file input. Real life upload not virtual. Generated in createFileObject in useFileManager.ts
  extractedText?: string | null; //text extracted from image/pdf
  originalText?: string | null; //text typed into app by user
  contextText?: string | null; //context provided along with either the file upload or fhir upload
  fhirData?: any;
  belroseFields?: BelroseFields; //AI enriched fields for easy labeling within the Belrose App. Comes from Cloud function
  customData?: any; //for non-medical data that may come in different formats, but not be particularly suited to FHIR format

  // Individual encrypted fields (as stored in Firestore)
  encryptedFileName?: { encrypted: string; iv: string };
  encryptedExtractedText?: { encrypted: string; iv: string };
  encryptedOriginalText?: { encrypted: string; iv: string };
  encryptedContextText?: { encrypted: string; iv: string };
  encryptedFhirData?: { encrypted: string; iv: string };
  encryptedBelroseFields?: { encrypted: string; iv: string };
  encryptedCustomData?: { encrypted: string; iv: string };

  // Encryption fields at ROOT level (as stored in Firestore)
  isEncrypted?: boolean;
  encryptedFileIV?: string; // IV for the file stored in Firebase Storage

  //Used during processing, ArrayBuffers are in memory. But roo-level encrypted Fiels are for retrieval in Firestore
  encryptedData?: {
    encryptedKey: string; // Single key for all encrypted data (Base64)

    // Encrypted fileName (always exists - contains PII!) — base64, not a raw ArrayBuffer
    fileName: {
      encrypted: string; // Base64
      iv: string; // Base64
    };

    // Encrypted file (original upload) — the one field EncryptionService.encryptCompleteRecord
    // returns as a raw ArrayBuffer instead of base64, since it's only held in memory during upload
    file?: {
      encrypted: ArrayBuffer;
      iv: string; // Base64
    };

    // Encrypted extracted text
    extractedText?: {
      encrypted: string; // Base64
      iv: string; // Base64
    };

    // Encrypted original text (if exists)
    originalText?: {
      encrypted: string; // Base64
      iv: string; // Base64
    };

    // Encrypted context text (if exists)
    contextText?: {
      encrypted: string; // Base64
      iv: string; // Base64
    };

    // Encrypted FHIR data (if exists)
    fhirData?: {
      encrypted: string; // Base64
      iv: string; // Base64
    };

    // Encrypted belrose fields (if exists)
    belroseFields?: {
      encrypted: string; // Base64
      iv: string; // Base64
    };

    // Encrypted custom data (if exists)
    customData?: {
      encrypted: string; // Base64
      iv: string; // Base64
    };
  };
}

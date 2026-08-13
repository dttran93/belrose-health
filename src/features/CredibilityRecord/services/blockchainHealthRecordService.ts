// src/features/BlockchainVerification/services/healthRecordCoreService.ts
//
// Frontend service for HealthRecordCore smart contract.
// Uses PaymasterService for all write transactions (handles sponsored vs direct).
//
// KEY FEATURES:
// - Record anchoring (patients link themselves to health records)
// - Record verification (providers vouch for record accuracy)
// - Record disputes (flag inaccurate records)
// - Unaccepted update flags (admin-only, tracks refused record updates)
//
// Read operations: No wallet needed (uses public RPC)
// Write operations: Routes through PaymasterService

import { ethers, Contract, id } from 'ethers';
import {
  PaymasterService,
  TransactionResult,
} from '@/features/BlockchainWallet/services/paymasterService';
import { buildRpcUrl, HEALTH_RECORD_CORE, NETWORK } from '@belrose/shared';
import { HealthRecordCore__factory } from '@belrose/shared';
import { requireEnv } from '@/utils/utils';

// ============================================================================
// CONFIG
// ============================================================================

const HEALTH_RECORD_CORE_ADDRESS = HEALTH_RECORD_CORE.proxy;
const RPC_URL = buildRpcUrl(requireEnv('VITE_ALCHEMY_API_KEY'));
const RPC_URL_FALLBACK = NETWORK.rpcUrlFallback;

// ============================================================================
// ABI
// ============================================================================

const HEALTH_RECORD_CORE_ABI = HealthRecordCore__factory.abi;

// ============================================================================
// TYPES
// ============================================================================

/** Verification level - how thoroughly the record was verified */
export enum VerificationLevel {
  None = 0,
  Provenance = 1, // Verified the source/origin
  Content = 2, // Verified the content accuracy
  Full = 3, // Full verification (provenance + content)
}

/** Dispute severity - how serious is the inaccuracy */
export enum DisputeSeverity {
  None = 0,
  Negligible = 1, // Minor issue, doesn't affect care
  Moderate = 2, // Could affect care decisions
  Major = 3, // Serious inaccuracy, dangerous
}

/** Dispute culpability - who/what is responsible */
export enum DisputeCulpability {
  None = 0,
  NoFault = 1, // Honest mistake, system glitch
  Systemic = 2, // Organizational/process failure
  Preventable = 3, // Should have been caught
  Reckless = 4, // Careless disregard
  Intentional = 5, // Deliberate falsification
}

export interface Verification {
  verifierIdHash: string;
  recordIdHash: string;
  level: VerificationLevel;
  createdAt: number;
  isActive: boolean;
}

export interface Dispute {
  disputerIdHash: string;
  recordIdHash: string;
  severity: DisputeSeverity;
  culpability: DisputeCulpability;
  notes: string;
  createdAt: number;
  isActive: boolean;
}

export interface UnacceptedUpdateFlag {
  recordIdHash: string;
  reporterIdHash: string;
  createdAt: number;
  recordHash: string;
  isActive: boolean;
}

export interface SubjectStats {
  total: number;
  active: number;
}

export interface VerificationStats {
  total: number;
  active: number;
}

export interface DisputeStats {
  total: number;
  active: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class blockchainHealthRecordService {
  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /** Get a read-only contract instance (no wallet needed) */
  private static getReadOnlyContract(): Contract {
    const provider = new ethers.FallbackProvider([
      new ethers.JsonRpcProvider(
        RPC_URL,
        { name: NETWORK.name, chainId: NETWORK.chainId },
        { staticNetwork: true }
      ),
      new ethers.JsonRpcProvider(
        RPC_URL_FALLBACK,
        { name: NETWORK.name, chainId: NETWORK.chainId },
        { staticNetwork: true }
      ),
    ]);
    return new ethers.Contract(HEALTH_RECORD_CORE_ADDRESS, HEALTH_RECORD_CORE_ABI, provider);
  }

  /** Encode function call data for a write transaction */
  private static encodeFunctionData(functionName: string, args: unknown[]): `0x${string}` {
    const iface = new ethers.Interface(HEALTH_RECORD_CORE_ABI);
    return iface.encodeFunctionData(functionName, args) as `0x${string}`;
  }

  /** Execute a write transaction via PaymasterService */
  private static async executeWrite(
    functionName: string,
    args: unknown[]
  ): Promise<TransactionResult> {
    const data = this.encodeFunctionData(functionName, args);

    return await PaymasterService.sendTransaction({
      to: HEALTH_RECORD_CORE_ADDRESS as `0x${string}`,
      data,
    });
  }

  // ==========================================================================
  // RECORD ANCHORING - WRITE FUNCTIONS
  // ==========================================================================

  /**
   * Anchor yourself as a subject to a record with a hash.
   * First subject establishes the initial hash; subsequent subjects confirm it.
   *
   * @param selfVerifyLevel Nudge param passed to the contract — defaults to Full, since anchoring
   *   ("this record is about me") in most cases also means confirming its contents. Pass
   *   VerificationLevel.None to opt out. Never blocks the anchor even if the verify guard fails.
   */
  static async anchorRecord(
    recordId: string,
    recordHash: string,
    selfVerifyLevel: VerificationLevel = VerificationLevel.Full
  ): Promise<TransactionResult> {
    console.log('⛓️ Anchoring record...', {
      recordId,
      recordHash: recordHash.slice(0, 12) + '...',
      selfVerifyLevel,
    });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('anchorRecord', [
      recordIdHash,
      recordHash,
      ethers.ZeroHash,
      selfVerifyLevel,
    ]);
    console.log('✅ Record anchored:', result.txHash);
    return result;
  }

  /**
   * Anchor a trustor as a subject on behalf of the caller, who must be their active controller.
   * Passes the trustor's ID hash as subjectIdHash; the contract verifies isControllerOf().
   *
   * @param selfVerifyLevel Same self-verify nudge as anchorRecord — the CALLER (controller) is
   *   credited as verifier, not the trustor, since the controller is the one actually attesting.
   */
  static async anchorRecordAsController(
    recordId: string,
    recordHash: string,
    trustorId: string,
    selfVerifyLevel: VerificationLevel = VerificationLevel.Full
  ): Promise<TransactionResult> {
    console.log('⛓️ Anchoring record as controller...', {
      recordId,
      recordHash: recordHash.slice(0, 12) + '...',
      trustorId,
      selfVerifyLevel,
    });
    const recordIdHash = id(recordId);
    const subjectIdHash = id(trustorId);
    const result = await this.executeWrite('anchorRecord', [
      recordIdHash,
      recordHash,
      subjectIdHash,
      selfVerifyLevel,
    ]);
    console.log('✅ Record anchored as controller:', result.txHash);
    return result;
  }

  /** Deactivate your subject link (soft delete) */
  static async unanchorRecord(recordId: string): Promise<TransactionResult> {
    console.log('⛓️ Unanchoring record...', { recordId });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('unanchorRecord', [recordIdHash, ethers.ZeroHash]);
    console.log('✅ Record unanchored:', result.txHash);
    return result;
  }

  /** Reactivate a previously unanchored subject link */
  static async reanchorRecord(recordId: string): Promise<TransactionResult> {
    console.log('⛓️ Reanchoring record...', { recordId });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('reanchorRecord', [recordIdHash, ethers.ZeroHash]);
    console.log('✅ Record reanchored:', result.txHash);
    return result;
  }

  /** Add a new hash version to an existing record (owner/admin only) */
  static async addRecordHash(recordId: string, newHash: string): Promise<TransactionResult> {
    const recordIdHash = id(recordId);
    console.log('⛓️ Adding record hash...', {
      recordIdHash,
      newHash: recordId.slice(0, 12) + '...',
    });
    const result = await this.executeWrite('addRecordHash', [recordIdHash, newHash]);
    console.log('✅ Hash added:', result.txHash);
    return result;
  }

  // ==========================================================================
  // RECORD ANCHORING - VIEW FUNCTIONS
  // ==========================================================================

  /** Get all subjects (patients) of a record */
  static async getRecordSubjects(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getRecordSubjects');
      return await fn(recordIdHash);
    } catch (error) {
      console.error('Error getting record subjects:', error);
      return [];
    }
  }

  /** Get all records where a user is the subject (medical history) */
  static async getSubjectMedicalHistory(userIdHash: string): Promise<string[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getSubjectMedicalHistory');
      return await fn(userIdHash);
    } catch (error) {
      console.error('Error getting subject medical history:', error);
      return [];
    }
  }

  /** Get only ACTIVE records where a user is the subject (excludes unanchored) */
  static async getActiveSubjectMedicalHistory(userId: string): Promise<string[]> {
    try {
      const contract = this.getReadOnlyContract();
      const userIdHash = id(userId);

      // getActiveSubjectMedicalHistory doesn't exist on-chain —
      // fetch all and filter active status ourselves
      const fn = contract.getFunction('getSubjectMedicalHistory');
      const allRecordIdHashes: string[] = await fn(userIdHash);

      if (allRecordIdHashes.length === 0) return [];

      // Check active status for each record in parallel
      const activeChecks = await Promise.all(
        allRecordIdHashes.map(recordIdHash => this.isActiveSubject(recordIdHash, userIdHash))
      );

      return allRecordIdHashes.filter((_, index) => activeChecks[index]);
    } catch (error) {
      console.error('Error getting active subject medical history:', error);
      return [];
    }
  }

  /** Check if a user is a subject of a record */
  static async isSubject(recordId: string, userIdHash: string): Promise<boolean> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('isSubject');
      return await fn(recordIdHash, userIdHash);
    } catch (error) {
      console.error('Error checking if subject:', error);
      return false;
    }
  }

  /** Check if a user is an ACTIVE subject of a record */
  static async isActiveSubject(recordId: string, userIdHash: string): Promise<boolean> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('isActiveSubject');
      return await fn(recordIdHash, userIdHash);
    } catch (error) {
      console.error('Error checking if active subject:', error);
      return false;
    }
  }

  /** Get only active subjects for a record */
  static async getActiveRecordSubjects(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getActiveRecordSubjects');
      return await fn(recordIdHash);
    } catch (error) {
      console.error('Error getting active record subjects:', error);
      return [];
    }
  }

  /** Get subject stats (total and active) for a record */
  static async getSubjectStats(recordId: string): Promise<SubjectStats> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getSubjectStats');
      const result = await fn(recordIdHash);
      return {
        total: Number(result[0]),
        active: Number(result[1]),
      };
    } catch (error) {
      console.error('Error getting subject stats:', error);
      return { total: 0, active: 0 };
    }
  }

  /** Get all hash versions for a record */
  static async getRecordVersionHistory(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getRecordVersionHistory');
      return await fn(recordIdHash);
    } catch (error) {
      console.error('Error getting record version history:', error);
      return [];
    }
  }

  /** Get the recordIdHash that a content hash belongs to */
  static async getRecordIdForHash(recordHash: string): Promise<string> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getRecordIdForHash');
      return await fn(recordHash);
    } catch (error) {
      console.error('Error getting record ID for hash:', error);
      return '';
    }
  }

  /** Check if a hash exists in the system */
  static async doesHashExist(recordHash: string): Promise<boolean> {
    const contract = this.getReadOnlyContract();
    const fn = contract.getFunction('doesHashExist');
    return await fn(recordHash); // let it throw on failure
  }

  /** Get the number of versions for a record */
  static async getVersionCount(recordId: string): Promise<number> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getVersionCount');
      const count = await fn(recordIdHash);
      return Number(count);
    } catch (error) {
      console.error('Error getting version count:', error);
      return 0;
    }
  }

  /** Get total number of anchored records in the system */
  static async getTotalAnchoredRecords(): Promise<number> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getTotalAnchoredRecords');
      const total = await fn();
      return Number(total);
    } catch (error) {
      console.error('Error getting total anchored records:', error);
      return 0;
    }
  }

  // ==========================================================================
  // VERIFICATIONS - WRITE FUNCTIONS
  // ==========================================================================

  /**
   * Verify a record hash (vouch for its accuracy)
   * @param level 1=Provenance, 2=Content, 3=Full
   */
  static async verifyRecord(
    recordId: string,
    recordHash: string,
    level: VerificationLevel
  ): Promise<TransactionResult> {
    console.log('✅ Verifying record...', { recordId, level });
    // Ensure the recordId is hashed and has the 0x prefix before passing it to encodeFunctionData
    // We could also just pass recordIdHash directly from the document on the front end.
    // But want to keep this split: recordId on frontend recordIdHash for blockchain
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('verifyRecord', [recordIdHash, recordHash, level]);
    console.log('✅ Record verified:', result.txHash);
    return result;
  }

  /** Retract your verification */
  static async retractVerification(recordHash: string): Promise<TransactionResult> {
    console.log('↩️ Retracting verification...', { recordHash: recordHash.slice(0, 12) + '...' });
    const result = await this.executeWrite('retractVerification', [recordHash]);
    console.log('✅ Verification retracted:', result.txHash);
    return result;
  }

  /** Modify your verification level */
  static async modifyVerificationLevel(
    recordHash: string,
    newLevel: VerificationLevel
  ): Promise<TransactionResult> {
    console.log('✏️ Modifying verification level...', { newLevel });
    const result = await this.executeWrite('modifyVerificationLevel', [recordHash, newLevel]);
    console.log('✅ Verification level modified:', result.txHash);
    return result;
  }

  // ==========================================================================
  // VERIFICATIONS - VIEW FUNCTIONS
  // ==========================================================================

  /** Get all verifications for a record hash */
  static async getVerifications(recordHash: string): Promise<Verification[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getVerifications');
      const raw = await fn(recordHash);

      return raw.map((v: any) => ({
        verifierIdHash: v.verifierIdHash,
        recordIdHash: v.recordIdHash,
        level: Number(v.level) as VerificationLevel,
        createdAt: Number(v.createdAt),
        isActive: v.isActive,
      }));
    } catch (error) {
      console.error('Error getting verifications:', error);
      return [];
    }
  }

  /** Check if a user has verified a record hash */
  static async hasUserVerified(recordHash: string, userIdHash: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('hasUserVerified');
      return await fn(recordHash, userIdHash);
    } catch (error) {
      console.error('Error checking if user verified:', error);
      return false;
    }
  }

  /** Get a specific user's verification for a hash */
  static async getUserVerification(
    recordHash: string,
    userIdHash: string
  ): Promise<{
    exists: boolean;
    recordIdHash: string;
    level: VerificationLevel;
    createdAt: number;
    isActive: boolean;
  }> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUserVerification');
      const result = await fn(recordHash, userIdHash);

      return {
        exists: result[0],
        recordIdHash: result[1],
        level: Number(result[2]) as VerificationLevel,
        createdAt: Number(result[3]),
        isActive: result[4],
      };
    } catch (error) {
      console.error('Error getting user verification:', error);
      return {
        exists: false,
        recordIdHash: '',
        level: VerificationLevel.None,
        createdAt: 0,
        isActive: false,
      };
    }
  }

  /** Get verification stats for a record hash */
  static async getVerificationStats(recordHash: string): Promise<VerificationStats> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getVerificationStats');
      const result = await fn(recordHash);
      return {
        total: Number(result[0]),
        active: Number(result[1]),
      };
    } catch (error) {
      console.error('Error getting verification stats:', error);
      return { total: 0, active: 0 };
    }
  }

  /** Get all hashes a user has verified */
  static async getUserVerifications(userIdHash: string): Promise<string[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUserVerifications');
      return await fn(userIdHash);
    } catch (error) {
      console.error('Error getting user verifications:', error);
      return [];
    }
  }

  // ==========================================================================
  // DISPUTES - WRITE FUNCTIONS
  // ==========================================================================

  /** Dispute a record hash (flag it as inaccurate) */
  static async disputeRecord(
    recordId: string,
    recordHash: string,
    severity: DisputeSeverity,
    culpability: DisputeCulpability,
    notesHash: string
  ): Promise<TransactionResult> {
    console.log('⚠️ Disputing record...', { recordId, severity, culpability });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('disputeRecord', [
      recordIdHash,
      recordHash,
      severity,
      culpability,
      notesHash,
    ]);
    console.log('✅ Record disputed:', result.txHash);
    return result;
  }

  /** Retract your dispute */
  static async retractDispute(recordHash: string): Promise<TransactionResult> {
    console.log('↩️ Retracting dispute...');
    const result = await this.executeWrite('retractDispute', [recordHash]);
    console.log('✅ Dispute retracted:', result.txHash);
    return result;
  }

  /** Modify your dispute's severity and culpability */
  static async modifyDispute(
    recordHash: string,
    newSeverity: DisputeSeverity,
    newCulpability: DisputeCulpability
  ): Promise<TransactionResult> {
    console.log('✏️ Modifying dispute...', { newSeverity, newCulpability });
    const result = await this.executeWrite('modifyDispute', [
      recordHash,
      newSeverity,
      newCulpability,
    ]);
    console.log('✅ Dispute modified:', result.txHash);
    return result;
  }

  // ==========================================================================
  // DISPUTES - VIEW FUNCTIONS
  // ==========================================================================

  /** Get all disputes for a record hash */
  static async getDisputes(recordHash: string): Promise<Dispute[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getDisputes');
      const raw = await fn(recordHash);

      return raw.map((d: any) => ({
        disputerIdHash: d.disputerIdHash,
        recordIdHash: d.recordIdHash,
        severity: Number(d.severity) as DisputeSeverity,
        culpability: Number(d.culpability) as DisputeCulpability,
        notes: d.notes,
        createdAt: Number(d.createdAt),
        isActive: d.isActive,
      }));
    } catch (error) {
      console.error('Error getting disputes:', error);
      return [];
    }
  }

  /** Check if a user has disputed a record hash */
  static async hasUserDisputed(recordHash: string, userIdHash: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('hasUserDisputed');
      return await fn(recordHash, userIdHash);
    } catch (error) {
      console.error('Error checking if user disputed:', error);
      return false;
    }
  }

  /** Get a specific user's dispute for a hash */
  static async getUserDispute(
    recordHash: string,
    userIdHash: string
  ): Promise<{
    exists: boolean;
    recordIdHash: string;
    severity: DisputeSeverity;
    culpability: DisputeCulpability;
    notes: string;
    createdAt: number;
    isActive: boolean;
  }> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUserDispute');
      const result = await fn(recordHash, userIdHash);

      return {
        exists: result[0],
        recordIdHash: result[1],
        severity: Number(result[2]) as DisputeSeverity,
        culpability: Number(result[3]) as DisputeCulpability,
        notes: result[4],
        createdAt: Number(result[5]),
        isActive: result[6],
      };
    } catch (error) {
      console.error('Error getting user dispute:', error);
      return {
        exists: false,
        recordIdHash: '',
        severity: DisputeSeverity.None,
        culpability: DisputeCulpability.None,
        notes: '',
        createdAt: 0,
        isActive: false,
      };
    }
  }

  /** Get dispute stats for a record hash */
  static async getDisputeStats(recordHash: string): Promise<DisputeStats> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getDisputeStats');
      const result = await fn(recordHash);
      return {
        total: Number(result[0]),
        active: Number(result[1]),
      };
    } catch (error) {
      console.error('Error getting dispute stats:', error);
      return { total: 0, active: 0 };
    }
  }

  /** Get all hashes a user has disputed */
  static async getUserDisputes(userIdHash: string): Promise<string[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUserDisputes');
      return await fn(userIdHash);
    } catch (error) {
      console.error('Error getting user disputes:', error);
      return [];
    }
  }

  // ==========================================================================
  // UNACCEPTED UPDATE FLAGS - VIEW FUNCTIONS
  // Note: Write functions (flagUnacceptedUpdate, resolveUnacceptedUpdate)
  // are admin-only and handled by Cloud Functions
  // ==========================================================================

  /** Get all flags for a subject */
  static async getUnacceptedUpdateFlags(subjectIdHash: string): Promise<UnacceptedUpdateFlag[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUnacceptedFlags');
      const raw = await fn(subjectIdHash);

      return raw.map((f: any) => ({
        recordIdHash: f.recordIdHash,
        reporterIdHash: f.reporterIdHash,
        recordHash: f.recordHash,
        createdAt: Number(f.createdAt),
        isActive: f.isActive,
      }));
    } catch (error) {
      console.error('Error getting unaccepted update flags:', error);
      return [];
    }
  }

  /** Get count of active (unresolved) flags for a subject */
  static async getActiveUnacceptedFlagCount(subjectIdHash: string): Promise<number> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getActiveUnacceptedFlagCount');
      const count = await fn(subjectIdHash);
      return Number(count);
    } catch (error) {
      console.error('Error getting active unaccepted flag count:', error);
      return 0;
    }
  }

  /** Check if a subject has any active flags */
  static async hasActiveUnacceptedFlags(subjectIdHash: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('hasActiveUnacceptedFlags');
      return await fn(subjectIdHash);
    } catch (error) {
      console.error('Error checking if has active unaccepted flags:', error);
      return false;
    }
  }

  // ==========================================================================
  // UTILITY
  // ==========================================================================

  /** Get the contract address (useful for debugging/display) */
  static getContractAddress(): string {
    return HEALTH_RECORD_CORE_ADDRESS;
  }
}

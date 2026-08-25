// src/features/ViewEditRecord/services/versionControlService.ts

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  where,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { FileObject } from '@/types/core';
import { diff as jsonDiff, IChange } from 'json-diff-ts';
import { RecordVersion, VersionDiff, RollbackResult, Change } from './versionControlService.types';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/utils/dataFormattingUtils';
import { SharingKeyManagementService } from '@/features/Sharing/services/sharingKeyManagementService';
import { encryptNotificationTitle } from '@/features/Notifications/services/encryptNotificationTitle';

// ==================== VERSION ID UTILITIES ====================

/**
 * Generates a semantic version ID: {recordId}_v{versionNumber}
 * Example: "abc123xyz_v0", "abc123xyz_v3"
 */
function generateVersionId(recordId: string, versionNumber: number): string {
  return `${recordId}_v${versionNumber}`;
}

// ==================== MAIN VERSION CONTROL SERVICE ====================

export class VersionControlService {
  private db = getFirestore();
  private auth = getAuth();

  private get currentUser() {
    return this.auth.currentUser;
  }

  private get userId() {
    if (!this.currentUser) throw new Error('User not authenticated');
    return this.currentUser.uid;
  }

  // ==================== ENCRYPTION KEY HELPER ====================

  /**
   * Helper to fetch the user's wrapped DEK for a given record.
   * Returns both the wrapped key and whether user is creator (which affects the unwrapping method)
   */
  private async fetchWrappedKeyData(
    recordId: string
  ): Promise<{ wrappedKey: string; isCreator: boolean }> {
    if (!this.userId) throw new Error('User not authenticated');

    console.log(`🔑 Fetching wrapped key for record ${recordId}...`);

    const q = query(
      collection(this.db, 'wrappedKeys'),
      where('recordId', '==', recordId),
      where('userId', '==', this.userId),
      limit(1)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      throw new Error(
        `Wrapped key not found for record ${recordId} and user ${this.userId}. Cannot perform versioning operations.`
      );
    }

    const firstDoc = snapshot.docs[0];
    if (!firstDoc) {
      throw new Error('Internal error: Document was expected but not found in snapshot.');
    }

    const docData = firstDoc.data();

    //Safely access the encrypted key and check its type
    const wrappedKey = docData.wrappedKey as string | undefined;
    if (!wrappedKey || typeof wrappedKey !== 'string') {
      throw new Error('Wrapped key data is corrupt or missing the "wrappedKey" field.');
    }

    return { wrappedKey, isCreator: docData.isCreator === true };
  }

  // ==================== CORE VERSION METHODS ====================

  /**
   * Create an initial version 0 when none exist yet
   */
  private async initializeVersioning(
    recordId: string,
    updatedRecord: FileObject,
    recordTitle?: string,
    commitMessage?: string
  ): Promise<string> {
    if (!this.currentUser) throw new Error('User not authenticated');

    // Step 1: Get the CURRENT record from Firestore (the original, pre-edit state)
    console.log('  📸 Fetching original record state...');
    const recordRef = doc(this.db, 'records', recordId);
    const recordSnap = await getDoc(recordRef);

    if (!recordSnap.exists()) {
      throw new Error('Record not found');
    }

    const originalRecord = recordSnap.data() as FileObject;

    // Step 2: Create Version 0 - snapshot of the ORIGINAL record (before this edit)
    console.log('  📦 Creating Version 0 (original baseline)...');

    // Generate semantic version ID
    const version0Id = generateVersionId(recordId, 0);

    const version0: any = {
      recordId,
      versionNumber: 0,
      commitMessage: 'Original Upload (auto-created baseline)',
      recordHash: originalRecord.recordHash || '',
      encryptedChanges: null,
    };

    // Store encrypted snapshot - includes ALL fields needed for hash regeneration
    version0.recordSnapshot = {
      encryptedFileName: originalRecord.encryptedFileName ?? null,
      encryptedExtractedText: originalRecord.encryptedExtractedText ?? null,
      encryptedOriginalText: originalRecord.encryptedOriginalText ?? null,
      encryptedContextText: originalRecord.encryptedContextText ?? null,
      encryptedFhirData: originalRecord.encryptedFhirData ?? null,
      encryptedBelroseFields: originalRecord.encryptedBelroseFields ?? null,
      encryptedCustomData: originalRecord.encryptedCustomData ?? null,
      originalFileHash: originalRecord.originalFileHash ?? null,
      fileType: originalRecord.fileType ?? null,
      fileSize: originalRecord.fileSize ?? null,
    };

    const cleanedV0 = this.cleanUndefinedValues(version0);

    // Use setDoc with semantic ID instead of addDoc
    await setDoc(doc(this.db, 'records', recordId, 'versionHistory', version0Id), cleanedV0);
    console.log(`🆕 Initial version 0 created with ID: ${version0Id}`);
    console.log('🆕 Continuing to Version 1...');

    //Delegate to createVersion for v1 now that v0 has been created
    const version1Id = await this.createVersion(
      recordId,
      updatedRecord,
      recordTitle,
      commitMessage
    );
    console.log('✅ Versioning initialized (V0 + V1 created)');
    return version1Id;
  }

  /**
   * For when a version already exist, Creates version 1 onwards
   */
  async createVersion(
    recordId: string,
    updatedRecord: FileObject,
    recordTitle?: string,
    commitMessage?: string
  ): Promise<string> {
    if (!this.currentUser) throw new Error('User not authenticated');

    console.log('📝 Creating version for record:', recordId);

    try {
      const versionHistory = await this.getVersionHistory(recordId);

      //If no versions exist, delegate to initialization. InitializeVersioning returns to here after creating v0
      if (versionHistory.length === 0) {
        console.log('📦 First edit detected — initializing versioning...');
        return await this.initializeVersioning(recordId, updatedRecord, commitMessage);
      }

      // Versions already exist - create next version normally
      // Array is descending by versionNumber, so index [0] is the newest version
      const latestVersion = versionHistory[0] as RecordVersion;
      const versionNumber = latestVersion.versionNumber + 1;

      console.log(
        `📝 Creating version ${versionNumber} (previous: ${latestVersion.versionNumber})`
      );

      // Generate semantic version ID
      const newVersionId = generateVersionId(recordId, versionNumber);

      // Fetch the encrypted key before calculating changes and encrypting changes
      const keyData = await this.fetchWrappedKeyData(recordId); // Use fetched key

      // Calculate changes from previous version
      const previousSnapshot = await this.decryptVersionSnapshot(latestVersion, keyData);
      const currentSnapshot = {
        fileName: updatedRecord.fileName ?? null,
        extractedText: updatedRecord.extractedText ?? null,
        originalText: updatedRecord.originalText ?? null,
        contextText: updatedRecord.contextText ?? null,
        fhirData: updatedRecord.fhirData ?? null,
        belroseFields: updatedRecord.belroseFields ?? null,
        customData: updatedRecord.customData ?? null,
        originalFileHash: updatedRecord.originalFileHash ?? null,
      };

      let changes = this.calculateDifferences(previousSnapshot, currentSnapshot);
      changes = this.cleanUndefinedValues(changes);

      const version: any = {
        recordId,
        versionNumber,
        editedBy: this.userId,
        editedByName: this.currentUser.displayName || this.currentUser.email || 'Unknown User',
        editedAt: Timestamp.now(),
        recordHash: updatedRecord.recordHash || '',
      };

      // Encrypt the record title for notifications
      const encryptedTitle = await encryptNotificationTitle(recordTitle || '', recordId);

      console.log(
        'Record title result:',
        recordTitle,
        '🔐 Encrypted title result:',
        encryptedTitle
      );

      if (encryptedTitle) {
        version.encryptedRecordTitle = encryptedTitle.encryptedRecordTitle;
        version.encryptedRecordTitleIv = encryptedTitle.encryptedRecordTitleIv;
      }

      // Encrypt changes if any exist
      if (changes.length > 0) {
        console.log('  🔐 Encrypting changes array...');
        version.encryptedChanges = await this.encryptChanges(changes, keyData);
        version.commitMessage = commitMessage || this.generateAutoCommitMessage(changes);
        console.log('  ✅ Changes encrypted');
      } else {
        version.encryptedChanges = null;
        version.commitMessage = commitMessage || 'No changes detected';
      }

      console.log('  🔐 Storing encrypted snapshot...');
      version.recordSnapshot = {
        encryptedFileName: updatedRecord.encryptedFileName,
        encryptedExtractedText: updatedRecord.encryptedExtractedText,
        encryptedOriginalText: updatedRecord.encryptedOriginalText,
        encryptedContextText: updatedRecord.encryptedContextText,
        encryptedFhirData: updatedRecord.encryptedFhirData,
        encryptedBelroseFields: updatedRecord.encryptedBelroseFields,
        encryptedCustomData: updatedRecord.encryptedCustomData ?? null,
        originalFileHash: updatedRecord.originalFileHash ?? null,
      };

      const cleanedVersion = this.cleanUndefinedValues(version);

      // Use setDoc with semantic ID instead of addDoc
      await setDoc(doc(this.db, 'records', recordId, 'versionHistory', newVersionId), cleanedVersion);

      console.log(`✅ Version ${versionNumber} created with ID: ${newVersionId}`);
      return newVersionId;
    } catch (error: any) {
      console.error('❌ Failed to create version:', error);
      throw new Error(`Failed to create version: ${error.message}`);
    }
  }

  /**
   * Get all versions for a record
   */
  async getVersionHistory(recordId: string, limitCount?: number): Promise<RecordVersion[]> {
    if (!this.currentUser) throw new Error('User not authenticated');

    // Verify user has access to this record
    const recordRef = doc(this.db, 'records', recordId);
    const recordSnap = await getDoc(recordRef);

    if (!recordSnap.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordSnap.data();
    const owners: string[] = recordData.owners || [recordData.uploadedBy];
    const administrators: string[] = recordData.administrators || [];
    const viewers: string[] = recordData.viewers || [];
    const subjects: string[] = recordData.subjects || [];

    const hasAccess =
      owners.includes(this.userId) ||
      administrators.includes(this.userId) ||
      viewers.includes(this.userId) ||
      subjects.includes(this.userId) ||
      recordData.uploadedBy === this.userId;

    if (!hasAccess) {
      throw new Error("You do not have permission to view this record's history");
    }

    try {
      // Query the record's versionHistory subcollection
      let q = query(
        collection(this.db, 'records', recordId, 'versionHistory'),
        orderBy('versionNumber', 'desc')
      );

      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const snapshot = await getDocs(q);

      const versions: RecordVersion[] = snapshot.docs.map(
        doc =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as RecordVersion
      );

      console.log(`📚 Found ${versions.length} versions for record ${recordId}`);
      return versions;
    } catch (error: any) {
      console.error('❌ Failed to get versions:', error);
      throw new Error(`Failed to get versions: ${error.message}`);
    }
  }

  /**
   * Get a specific version by ID
   */
  async getVersion(recordId: string, versionId: string): Promise<RecordVersion | null> {
    try {
      const versionRef = doc(this.db, 'records', recordId, 'versionHistory', versionId);
      const versionSnap = await getDoc(versionRef);

      if (!versionSnap.exists()) {
        return null;
      }

      return {
        id: versionSnap.id,
        ...versionSnap.data(),
      } as RecordVersion;
    } catch (error: any) {
      console.error('❌ Failed to get version:', error);
      throw new Error(`Failed to get version: ${error.message}`);
    }
  }

  /**
   * Get changes for a version, decrypt
   * Returns the actual Change[] array that can be displayed
   */
  async getVersionChanges(version: RecordVersion): Promise<Change[]> {
    if (!version.encryptedChanges) {
      return [];
    }

    const keyData = await this.fetchWrappedKeyData(version.recordId);
    return await this.decryptChanges(version.encryptedChanges, keyData);
  }

  /**
   * Decrypt a version's snapshot for viewing or comparison
   * Returns plaintext data whether version is encrypted or not
   */
  private async decryptVersionSnapshot(
    version: RecordVersion,
    keyData?: { wrappedKey: string; isCreator: boolean }
  ): Promise<any> {
    console.log(`🔓 Decrypting version ${version.versionNumber}...`);

    //Get the key from caller or fetch
    const { wrappedKey, isCreator } = keyData || (await this.fetchWrappedKeyData(version.recordId));

    // Check if encryption session is active
    const masterKey = await EncryptionKeyManager.getSessionKey();
    if (!masterKey) {
      throw new Error(
        'Cannot decrypt version: No active encryption session. Please unlock your encryption.'
      );
    }

    try {
      // Build an encrypted record object from the version snapshot
      const encryptedRecord = {
        id: version.recordId,
        encryptedFileName: version.recordSnapshot.encryptedFileName,
        encryptedExtractedText: version.recordSnapshot.encryptedExtractedText,
        encryptedOriginalText: version.recordSnapshot.encryptedOriginalText,
        encryptedContextText: version.recordSnapshot.encryptedContextText,
        encryptedFhirData: version.recordSnapshot.encryptedFhirData,
        encryptedBelroseFields: version.recordSnapshot.encryptedBelroseFields,
        encryptedCustomData: version.recordSnapshot.encryptedCustomData,
      };

      const decryptedData = await RecordDecryptionService.decryptRecord(
        encryptedRecord,
        wrappedKey,
        isCreator
      );
      console.log(`✅ Version ${version.versionNumber} decrypted successfully`);

      // Return ALL fields needed for hash regeneration
      return {
        fileName: decryptedData.fileName ?? null,
        extractedText: decryptedData.extractedText ?? null,
        originalText: decryptedData.originalText ?? null,
        contextText: decryptedData.contextText ?? null,
        fhirData: decryptedData.fhirData ?? null,
        belroseFields: decryptedData.belroseFields ?? null,
        customData: decryptedData.customData ?? null,
        originalFileHash: version.recordSnapshot.originalFileHash ?? null,
      };
    } catch (error: any) {
      console.error(`❌ Failed to decrypt version ${version.versionNumber}:`, error);
      throw new Error(`Failed to decrypt version: ${error.message}`);
    }
  }

  /**
   * Restore a record to a previous version
   */
  async rollbackToVersion(
    recordId: string,
    versionId: string,
    updateMainRecord = true
  ): Promise<RollbackResult> {
    if (!this.currentUser) throw new Error('User not authenticated');

    console.log('♻️ Restoring record to version:', versionId);

    try {
      // Get the version
      const version = await this.getVersion(recordId, versionId);
      if (!version) {
        throw new Error('Version not found');
      }

      // Verify user owns the record
      const recordRef = doc(this.db, 'records', recordId);
      const recordSnap = await getDoc(recordRef);

      if (!recordSnap.exists()) {
        throw new Error('Record not found');
      }

      const recordData = recordSnap.data();
      const owners: string[] = recordData.owners || [recordData.uploadedBy];
      const administrators: string[] = recordData.administrators || [];

      const isOwner = owners.includes(this.userId);
      const isAdmin = administrators.includes(this.userId);

      if (!isOwner && !isAdmin) {
        throw new Error("You do not have permission to rollback this record's history");
      }

      // Create a new version before restoring (so we can undo the restore)
      await this.createVersion(
        recordId,
        recordData as FileObject,
        `Before restoring to version ${version.versionNumber}`
      );

      // Decrypt the version snapshot
      const restoredData = await this.decryptVersionSnapshot(version);

      console.log('Restored Data', restoredData);

      // Optionally update the main record
      if (updateMainRecord) {
        const { updateFirestoreRecord } = await import('@/firebase/uploadUtils');
        await updateFirestoreRecord(
          recordId,
          restoredData,
          `Restored to version ${version.versionNumber}`
        );
      }

      console.log('✅ Record restored to version:', version.versionNumber);

      return {
        versionId: versionId,
        restoredData: restoredData,
      };
    } catch (error: any) {
      console.error('❌ Failed to restore version:', error);
      throw new Error(`Failed to restore version: ${error.message}`);
    }
  }

  /**
   * Delete all versions for a record (called when record is deleted)
   */
  async deleteAllVersions(recordId: string): Promise<void> {
    if (!this.currentUser) throw new Error('User not authenticated');

    try {
      console.log('🗑️ Deleting all versions for record:', recordId);

      // Get all versions
      const snapshot = await getDocs(collection(this.db, 'records', recordId, 'versionHistory'));

      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      console.log(`✅ Deleted ${snapshot.docs.length} versions`);
    } catch (error: any) {
      console.error('❌ Failed to delete versions:', error);
      console.warn('⚠️ Continuing despite version deletion error');
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(
    recordId: string,
    versionId1: string,
    versionId2: string
  ): Promise<VersionDiff> {
    const version1 = await this.getVersion(recordId, versionId1);
    const version2 = await this.getVersion(recordId, versionId2);

    if (!version1 || !version2) {
      throw new Error('One or both versions not found');
    }

    console.log('🔍 Comparing versions:', {
      v1: version1.versionNumber,
      v2: version2.versionNumber,
    });

    // Fetch the key once and pass it to avoid redundant lookups
    const keyData = await this.fetchWrappedKeyData(recordId);

    // Decrypt both versions with the same key data before comparing
    const decryptedSnapshot1 = await this.decryptVersionSnapshot(version1, keyData);
    const decryptedSnapshot2 = await this.decryptVersionSnapshot(version2, keyData);

    console.log('VersionJSON comparison:', {
      v1: decryptedSnapshot1,
      v2: decryptedSnapshot2,
    });

    // Ensure we're comparing the right order (older -> newer)
    const [olderVersion, newerVersion] =
      version1.versionNumber < version2.versionNumber ? [version1, version2] : [version2, version1];

    const [olderSnapshot, newerSnapshot] =
      version1.versionNumber < version2.versionNumber
        ? [decryptedSnapshot1, decryptedSnapshot2]
        : [decryptedSnapshot2, decryptedSnapshot1];

    // Now compare the DECRYPTED data
    const changes = this.calculateDifferences(olderSnapshot, newerSnapshot);

    return {
      olderVersionId: olderVersion.id || '',
      newerVersionId: newerVersion.id || '',
      changes,
      summary: this.generateDiffSummary(changes),
      timestamp: new Date().toISOString(),
    };
  }

  //=============================================================
  //ENCRYPTION/DECRYPTION HELPERS
  //===============================================================

  /**
   * Encrypt changes array using the record's data encryption key
   */
  private async encryptChanges(
    changes: Change[],
    keyData: { wrappedKey: string; isCreator: boolean }
  ): Promise<string> {
    console.log('🔐 Encrypting changes array...');

    // Get master key from session
    const masterKey = await EncryptionKeyManager.getSessionKey();
    if (!masterKey) {
      throw new Error('Cannot encrypt changes: No active encryption session');
    }

    // Unwrap the record's DEK based on user type
    const recordDEK = await this.unwrapRecordKey(keyData, masterKey);

    // Serialize changes to JSON string
    const changesJson = JSON.stringify(changes);

    // Encrypt using your EncryptionService
    const { encrypted, iv } = await EncryptionService.encryptText(changesJson, recordDEK);

    // Combine encrypted data and IV into a single base64 string
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(new Uint8Array(iv), 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);

    const encryptedChanges = arrayBufferToBase64(combined.buffer);

    console.log('✅ Changes encrypted successfully');
    return encryptedChanges;
  }

  /**
   * Decrypt changes array for viewing
   */
  private async decryptChanges(
    encryptedChanges: string,
    keyData: { wrappedKey: string; isCreator: boolean }
  ): Promise<Change[]> {
    console.log('🔓 Decrypting changes array...');

    // Get master key from session
    const masterKey = await EncryptionKeyManager.getSessionKey();
    if (!masterKey) {
      throw new Error(
        'Cannot decrypt changes: No active encryption session. Please unlock your encryption.'
      );
    }

    // Unwrap the record's DEK
    const recordDEK = await this.unwrapRecordKey(keyData, masterKey);

    // Decode the combined base64 string
    const combined = base64ToArrayBuffer(encryptedChanges);

    // Split into IV and encrypted data (IV is first 12 bytes for GCM)
    const ivLength = 12; // ENCRYPTION_CONFIG.ivLength
    const iv = combined.slice(0, ivLength);
    const encrypted = combined.slice(ivLength);

    // Decrypt using your EncryptionService
    const changesJson = await EncryptionService.decryptText(encrypted, recordDEK, iv);

    // Parse back to Change array
    const changes: Change[] = JSON.parse(changesJson);

    console.log(`✅ Decrypted ${changes.length} changes`);
    return changes;
  }

  /**
   * Unwrap the record DEK based on whether user is creator or shared user
   */
  private async unwrapRecordKey(
    keyData: { wrappedKey: string; isCreator: boolean },
    masterKey: CryptoKey
  ): Promise<CryptoKey> {
    const { wrappedKey, isCreator } = keyData;
    if (isCreator) {
      // Creator: key is AES-encrypted with master key
      console.log('ℹ️  Decrypting as creator (master key)...');
      const encryptedKeyData = base64ToArrayBuffer(wrappedKey);
      const fileKeyData = await EncryptionService.decryptKeyWithMasterKey(
        encryptedKeyData,
        masterKey
      );
      console.log('✅ Record key decrypted');
      return await EncryptionService.importKey(fileKeyData);
    } else {
      // Shared user needs to decrypt the with RSA private key
      console.log('ℹ️  Unwrapping as shared user (RSA)...');
      const rsaPrivateKey = await this.getUserPrivateKey(masterKey);
      return await SharingKeyManagementService.unwrapKey(wrappedKey, rsaPrivateKey);
    }
  }

  /**
   * Get current user's RSA private key (for shared record access)
   */
  private async getUserPrivateKey(masterKey: CryptoKey): Promise<CryptoKey> {
    const userRef = doc(this.db, 'users', this.userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      throw new Error('User profile not found');
    }

    const userData = userDoc.data();

    if (!userData?.encryption?.encryptedPrivateKey) {
      throw new Error('User does not have an encrypted private key stored');
    }

    const encryptedPrivateKeyData = base64ToArrayBuffer(userData.encryption.encryptedPrivateKey);
    const privateKeyIv = base64ToArrayBuffer(userData.encryption.encryptedPrivateKeyIV);

    const privateKeyBytes = await EncryptionService.decryptFile(
      encryptedPrivateKeyData,
      masterKey,
      privateKeyIv
    );

    return await SharingKeyManagementService.importPrivateKey(arrayBufferToBase64(privateKeyBytes));
  }

  // ==================== UTILITY METHODS ====================

  private calculateDifferences(oldData: any, newData: any): Change[] {
    try {
      const diffResult: IChange[] = jsonDiff(oldData, newData);

      if (!diffResult || diffResult.length === 0) {
        return [];
      }

      return this.flattenDiffToChanges(diffResult);
    } catch (error) {
      console.error('Error calculating differences:', error);
      return [];
    }
  }

  private flattenDiffToChanges(diffEntries: IChange[], pathPrefix: string = ''): Change[] {
    const changes: Change[] = [];

    for (const entry of diffEntries) {
      const isArrayIndex = typeof entry.key === 'string' && /^\d+$/.test(entry.key);
      const currentPath = !pathPrefix
        ? entry.key || ''
        : isArrayIndex
          ? `${pathPrefix}[${entry.key}]`
          : `${pathPrefix}.${entry.key}`;

      // json-diff-ts wraps every ancestor object/array level containing a nested
      // change in its own UPDATE entry with no value/oldValue (only `.changes`).
      // Only leaf UPDATE entries represent a real change.
      const isContainerUpdate = entry.type === 'UPDATE' && !!entry.changes && entry.changes.length > 0;

      if (entry.type === 'UPDATE' && !isContainerUpdate) {
        changes.push({
          operation: 'update',
          path: currentPath,
          oldValue: entry.oldValue,
          newValue: entry.value,
          description: `Updated ${currentPath}`,
        });
      } else if (entry.type === 'ADD') {
        changes.push({
          operation: 'create',
          path: currentPath,
          newValue: entry.value,
          description: `Added ${currentPath}`,
        });
      } else if (entry.type === 'REMOVE') {
        changes.push({
          operation: 'delete',
          path: currentPath,
          oldValue: entry.value,
          description: `Removed ${currentPath}`,
        });
      }

      // Recursively process nested changes
      if (entry.changes && entry.changes.length > 0) {
        const nestedChanges = this.flattenDiffToChanges(entry.changes, currentPath);
        changes.push(...nestedChanges);
      }
    }

    return changes;
  }

  private generateAutoCommitMessage(changes: Change[]): string {
    if (changes.length === 0) return 'No changes';
    if (changes.length === 1) return changes[0]?.description || 'Updated record';

    const operationCounts = changes.reduce(
      (acc, change) => {
        acc[change.operation] = (acc[change.operation] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const parts: string[] = [];
    if (operationCounts.create) parts.push(`${operationCounts.create} added`);
    if (operationCounts.update) parts.push(`${operationCounts.update} updated`);
    if (operationCounts.delete) parts.push(`${operationCounts.delete} removed`);

    return parts.join(', ');
  }

  private generateDiffSummary(changes: Change[]): string {
    const totalChanges = changes.length;
    if (totalChanges === 0) return 'No changes';

    const changedFields = new Set(changes.map(c => c.path.split('.')[0]));
    return `${totalChanges} change(s) across ${changedFields.size} field(s)`;
  }

  /**
   * Clean undefined values from objects recursively
   * Firestore doesn't allow undefined - must be null or omitted
   */
  private cleanUndefinedValues(data: any): any {
    if (Array.isArray(data)) {
      return data.map(item => this.cleanUndefinedValues(item));
    }

    if (data !== null && typeof data === 'object') {
      const cleaned: any = {};
      for (const key in data) {
        if (data[key] !== undefined) {
          cleaned[key] = this.cleanUndefinedValues(data[key]);
        }
      }
      return cleaned;
    }

    return data === undefined ? null : data;
  }
}

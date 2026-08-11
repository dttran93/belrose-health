// functions/src/notifications/triggers/recordEditNotificationTrigger.ts

/**
 * Record Edit Notification Trigger
 *
 * Watches records/{recordId}/versionHistory for new documents and notifies stakeholders.
 *
 * Who gets notified:
 *   - Owners (it's their record)
 *   - Subjects (it's their health data)
 *
 * Who doesn't:
 *   - The editor themselves
 *   - Admins (they're typically the ones editing)
 *   - Viewers (passive access only)
 *
 * Note: version 0 is always the auto-created baseline on first edit —
 * we skip it since it doesn't represent a real user edit.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { defineSecret } from 'firebase-functions/params';
import { createNotificationForMultiple, getUserDisplayName } from '../notificationUtils';
import { sendEmailIfEnabled } from '../emailUtils';
import { buildRecordEditedHtml, buildRecordEditedText } from '../emails/recordEditEmailTemplate';

// ============================================================================
// TYPES
// ============================================================================

//Kept this as it's own separate type from the front end because the front end has the complete record
// Snapshot, much more data than is necessary
interface RecordVersion {
  recordId: string;
  versionNumber: number;
  editedBy: string;
  editedByName?: string;
  editedAt: Timestamp;
  commitMessage?: string;
  recordHash: string;
  encryptedRecordTitle?: string;
  encryptedRecordTitleIv?: string;
}

interface RecordDocument {
  owners?: string[];
  subjects?: string[];
  uploadedBy?: string;
  fileName?: string;
  encryptedFileName?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const resendKey = defineSecret('RESEND_API_KEY');

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Returns owners + subjects, deduplicated, excluding the editor.
 */
function getNotificationTargets(record: RecordDocument, editedBy: string): string[] {
  const targets = [...(record.owners ?? []), ...(record.subjects ?? [])];
  return [...new Set(targets)].filter(uid => uid !== editedBy);
}

// ============================================================================
// TRIGGER: NEW VERSION CREATED
// ============================================================================

export const onRecordVersionCreated = onDocumentCreated(
  { document: 'records/{recordId}/versionHistory/{versionId}', secrets: [resendKey] },
  async event => {
    const recordId = event.params.recordId;
    const versionId = event.params.versionId;
    const data = event.data?.data() as RecordVersion | undefined;

    if (!data) {
      console.log('⚠️ No data in created version, skipping');
      return;
    }

    // Skip version 0 — it's an auto-created baseline, not a real edit
    if (data.versionNumber === 0) {
      console.log(`ℹ️ Version 0 baseline created for record ${recordId}, skipping notification`);
      return;
    }

    console.log(`📝 Version ${data.versionNumber} created for record ${recordId}`);

    // Fetch the record to get owners and subjects
    const recordSnap = await getFirestore().collection('records').doc(recordId).get();

    if (!recordSnap.exists) {
      console.log(`⚠️ Record ${recordId} not found, skipping notification`);
      return;
    }

    const record = recordSnap.data() as RecordDocument;
    const targets = getNotificationTargets(record, data.editedBy);

    if (targets.length === 0) {
      console.log('ℹ️ No other stakeholders to notify');
      return;
    }

    const editorName = data.editedByName ?? (await getUserDisplayName(data.editedBy));

    // Record name: we store encryptedFileName so fall back to a generic label
    // The notification links through to the record so users can see full details
    const recordName = `Record ${recordId.slice(0, 8)}...`;

    // In-app notifications
    await createNotificationForMultiple(targets, {
      type: 'RECORD_EDITED',
      message: `${editorName} made changes to ${recordName} (version ${data.versionNumber}).`,
      link: `/app/records/${recordId}`,
      payload: {
        recordId,
        versionId,
        versionNumber: data.versionNumber,
        editedBy: data.editedBy,
        encryptedRecordTitle: data.encryptedRecordTitle,
        encryptedRecordTitleIv: data.encryptedRecordTitleIv,
      },
    });

    // Emails
    const resend = new Resend(resendKey.value());
    await Promise.all(
      targets.map(uid =>
        sendEmailIfEnabled(
          uid,
          'RECORD_EDITED',
          {
            subject: `${editorName} edited a record you're connected to`,
            html: buildRecordEditedHtml(editorName, recordName, recordId, data.versionNumber),
            text: buildRecordEditedText(editorName, recordName, recordId, data.versionNumber),
          },
          resend
        )
      )
    );

    console.log(`✅ Edit notifications sent to ${targets.length} stakeholder(s)`);
  }
);

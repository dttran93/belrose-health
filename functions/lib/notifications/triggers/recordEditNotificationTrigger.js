"use strict";
// functions/src/notifications/triggers/recordEditNotificationTrigger.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.onRecordVersionCreated = void 0;
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
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const resend_1 = require("resend");
const params_1 = require("firebase-functions/params");
const notificationUtils_1 = require("../notificationUtils");
const emailUtils_1 = require("../emailUtils");
const recordEditEmailTemplate_1 = require("../emails/recordEditEmailTemplate");
// ============================================================================
// CONSTANTS
// ============================================================================
const resendKey = (0, params_1.defineSecret)('RESEND_API_KEY');
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Returns owners + subjects, deduplicated, excluding the editor.
 */
function getNotificationTargets(record, editedBy) {
    const targets = [...(record.owners ?? []), ...(record.subjects ?? [])];
    return [...new Set(targets)].filter(uid => uid !== editedBy);
}
// ============================================================================
// TRIGGER: NEW VERSION CREATED
// ============================================================================
exports.onRecordVersionCreated = (0, firestore_1.onDocumentCreated)({ document: 'records/{recordId}/versionHistory/{versionId}', secrets: [resendKey] }, async (event) => {
    const recordId = event.params.recordId;
    const versionId = event.params.versionId;
    const data = event.data?.data();
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
    const recordSnap = await (0, firestore_2.getFirestore)().collection('records').doc(recordId).get();
    if (!recordSnap.exists) {
        console.log(`⚠️ Record ${recordId} not found, skipping notification`);
        return;
    }
    const record = recordSnap.data();
    const targets = getNotificationTargets(record, data.editedBy);
    if (targets.length === 0) {
        console.log('ℹ️ No other stakeholders to notify');
        return;
    }
    const editorName = data.editedByName ?? (await (0, notificationUtils_1.getUserDisplayName)(data.editedBy));
    // Record name: we store encryptedFileName so fall back to a generic label
    // The notification links through to the record so users can see full details
    const recordName = `Record ${recordId.slice(0, 8)}...`;
    // In-app notifications
    await (0, notificationUtils_1.createNotificationForMultiple)(targets, {
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
    const resend = new resend_1.Resend(resendKey.value());
    await Promise.all(targets.map(uid => (0, emailUtils_1.sendEmailIfEnabled)(uid, 'RECORD_EDITED', {
        subject: `${editorName} edited a record you're connected to`,
        html: (0, recordEditEmailTemplate_1.buildRecordEditedHtml)(editorName, recordName, recordId, data.versionNumber),
        text: (0, recordEditEmailTemplate_1.buildRecordEditedText)(editorName, recordName, recordId, data.versionNumber),
    }, resend)));
    console.log(`✅ Edit notifications sent to ${targets.length} stakeholder(s)`);
});
//# sourceMappingURL=recordEditNotificationTrigger.js.map
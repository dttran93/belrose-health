import { BlockchainRef } from './blockchainAddresses';
import { TimestampLike } from './timestamp';

/**
 * Document structure for the records/{recordId}/recordHashHistory subcollection — an
 * append-only audit ledger for when a record's content hash gets anchored on-chain
 * (HealthRecordCore.anchorRecord / addRecordHash). Parallel to subjectHistory/
 * trusteeHistory, but keyed by `hash` specifically, since neither subjectHistory nor a
 * verification/dispute doc records which hash a given event actually applies to once a
 * record has been edited past that version.
 *
 * A hash only ever gets anchored via two paths — a subject's first anchor
 * (setSubjectAsSelf/anchorSubjectAsController/acceptSubjectRequest, anchoredVia: 'subject')
 * or a credibility prepare step ahead of a verification/dispute
 * (CredibilityPreparationService.prepare, anchoredVia: 'credibility'). Never from a
 * permission grant, and never automatically on version save.
 *
 * Only 'anchored' exists today — retractRecordHash (which can deactivate a hash once a
 * newer version supersedes it) is never called from the frontend, so there's no
 * un-anchor action to model yet.
 */
export type RecordHashHistoryAction = 'anchored';

export interface RecordHashHistoryEvent {
  recordId: string;
  recordIdHash: string;
  hash: string;
  action: RecordHashHistoryAction;
  anchoredVia: 'subject' | 'credibility';
  changedBy: string;
  changedByIdHash: string;
  changedAt: TimestampLike;
  // null until the deferred blockchain call resolves — see writeRecordHashHistoryEvent.ts
  blockchainRef: BlockchainRef | null;
}

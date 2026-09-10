import type { TimestampLike } from "./timestamp";
export interface RecordRequest {
    inviteCode: string;
    requesterId: string;
    requesterEmail: string;
    requesterName: string;
    requesterPublicKey: string;
    targetEmail: string;
    targetUserId: string | null;
    encryptedRequestNote: string | null;
    encryptedNoteKeyForRequester: string | null;
    encryptedNoteKeyForProvider: string | null;
    encryptedNoteIv: string | null;
    status: RecordRequestStatus;
    createdAt: TimestampLike;
    readAt: TimestampLike | null;
    lastRemindedAt: TimestampLike | null;
    viewCount: number;
    deadline: TimestampLike;
    fulfilledRecordIds: string[];
    fulfilledAt?: TimestampLike;
    deniedAt?: TimestampLike;
    deniedReason?: DenyReasonValue;
    deniedNote?: string;
    cancelledAt?: TimestampLike;
}
export type RecordRequestStatus = 'pending' | 'fulfilled' | 'denied' | 'cancelled';
export declare const DENY_REASONS: readonly [{
    readonly value: "wrong_recipient";
    readonly label: "Wrong recipient — I am not the stated provider";
}, {
    readonly value: "never_held";
    readonly label: "Never saw this patient, never held these records";
}, {
    readonly value: "retention_lapsed";
    readonly label: "Records were held but are no longer accessible";
}, {
    readonly value: "cannot_identify";
    readonly label: "I cannot confirm the identity of the patient and am withholding records";
}, {
    readonly value: "other";
    readonly label: "Other";
}];
export type DenyReasonValue = (typeof DENY_REASONS)[number]['value'];
//# sourceMappingURL=recordRequest.d.ts.map
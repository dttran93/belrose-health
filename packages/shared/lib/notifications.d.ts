export declare const NOTIFICATION_CATEGORIES: {
    readonly recordEditing: {
        readonly label: "Record Editing";
        readonly description: "Get notifications when your records are edited.";
        readonly notificationTypes: readonly ["RECORD_EDITED"];
    };
    readonly recordDeletion: {
        readonly label: "Record Deletion";
        readonly description: "Get notifications when your records are deleted.";
        readonly notificationTypes: readonly ["RECORD_DELETED"];
    };
    readonly subjectRequests: {
        readonly label: "Subject Requests";
        readonly description: "Get notifications when someone requests you as a subject or responds to your subject requests.";
        readonly notificationTypes: readonly ["SUBJECT_REQUEST_RECEIVED", "SUBJECT_ACCEPTED", "REJECTION_PENDING_CREATOR_DECISION", "REJECTION_ACKNOWLEDGED", "REJECTION_ESCALATED"];
    };
    readonly permissions: {
        readonly label: "Permissions Changes";
        readonly description: "Get notifications when your permissions change on a record.";
        readonly notificationTypes: readonly ["PERMISSIONS_GRANTED", "PERMISSIONS_REVOKED"];
    };
    readonly credibility: {
        readonly label: "Credibility Updates";
        readonly description: "Get notifications when your verifications or disputes are made on your records.";
        readonly notificationTypes: readonly ["VERIFICATION_ADDED", "VERIFICATION_MODIFIED", "VERIFICATION_RETRACTED", "DISPUTE_ADDED", "DISPUTE_MODIFIED", "DISPUTE_RETRACTED"];
    };
    readonly trustee: {
        readonly label: "Trustee Relationships";
        readonly description: "Get notifications regarding trustee relationship changes.";
        readonly notificationTypes: readonly ["TRUSTEE_INVITE_RECEIVED", "TRUSTEE_INVITE_ACCEPTED", "TRUSTEE_INVITE_DECLINED", "TRUSTEE_REVOKED", "TRUSTEE_RESIGNED", "TRUSTEE_LEVEL_CHANGED"];
    };
    readonly recordRequests: {
        readonly label: "Record Requests";
        readonly description: "Get notifications when someone responds to your record requests.";
        readonly notificationTypes: readonly ["RECORD_REQUEST_RECEIVED", "RECORD_REQUEST_VIEWED", "RECORD_REQUEST_FULFILLED", "RECORD_REQUEST_DENIED"];
    };
    readonly system: {
        readonly label: "System Notifications";
        readonly description: "Get notifications about system updates and important announcements.";
        readonly notificationTypes: readonly ["GENERIC_NOTIFICATION"];
    };
};
export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;
export type NotificationType = (typeof NOTIFICATION_CATEGORIES)[NotificationCategory]['notificationTypes'][number];
export declare const NOTIFICATION_MAPPING: Record<NotificationType, NotificationCategory>;
export interface ChannelPrefs {
    inApp: boolean;
    email: boolean;
}
export type NotificationPrefs = Partial<Record<NotificationType, ChannelPrefs>>;
export declare const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs;
//# sourceMappingURL=notifications.d.ts.map
// packages/shared/src/timestamp.ts

// Structurally compatible with BOTH the client SDK's Timestamp ('firebase/firestore') and the
// Admin SDK's Timestamp ('firebase-admin/firestore') — deliberately does NOT include toJSON(),
// which the client SDK has but the Admin SDK does not. Nothing in this codebase calls .toJSON()
// on a TimestampLike value; requiring it here would make this type unusable for anything
// constructed server-side (functions/), which is exactly where cross-workspace shared types need
// to work.
export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
  isEqual(other: TimestampLike): boolean;
  valueOf(): string;
}

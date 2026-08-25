export interface TimestampLike {
    seconds: number;
    nanoseconds: number;
    toDate(): Date;
    toMillis(): number;
    isEqual(other: TimestampLike): boolean;
    valueOf(): string;
}
//# sourceMappingURL=timestamp.d.ts.map
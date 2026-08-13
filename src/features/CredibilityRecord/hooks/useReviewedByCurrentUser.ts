// src/features/CredibilityRecord/hooks/useReviewedByCurrentUser.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/features/Auth/hooks/useAuth';
import { getVerification } from '../services/verificationService';
import { FileObject } from '@/types/core';
import { getDispute } from '../services/disputeService';

export function useReviewedByCurrentUser(record: FileObject) {
  const { user } = useAuth();
  const [hasReviewed, setHasReviewed] = useState(false);
  const [reviewedCurrentVersion, setReviewedCurrentVersion] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const check = useCallback(async () => {
    if (!user?.uid || !record.recordHash) {
      setHasReviewed(false);
      setReviewedCurrentVersion(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [verification, dispute] = await Promise.all([
        getVerification(record.recordHash, user.uid),
        getDispute(record.recordHash, user.uid, false),
      ]);

      const hasActiveVerification = !!verification && verification.isActive;
      const hasActiveDispute = !!dispute && dispute.isActive;
      const reviewedCurrent = hasActiveVerification || hasActiveDispute;

      setReviewedCurrentVersion(reviewedCurrent);

      // If they haven't reviewed the current version, check previous hashes
      if (!reviewedCurrent && record.previousRecordHash?.length) {
        const previousChecks = await Promise.all(
          record.previousRecordHash.map(hash =>
            Promise.all([getVerification(hash, user.uid), getDispute(hash, user.uid, false)])
          )
        );

        const reviewedPrevious = previousChecks.some(
          ([v, d]) => (v && v.isActive) || (d && d.isActive)
        );

        setHasReviewed(reviewedPrevious || reviewedCurrent);
      } else {
        setHasReviewed(reviewedCurrent);
      }
    } catch {
      setHasReviewed(false);
      setReviewedCurrentVersion(false);
    } finally {
      setIsLoading(false);
    }
  }, [record.recordHash, record.previousRecordHash, user?.uid]);

  useEffect(() => {
    check();
  }, [record.recordHash, record.previousRecordHash, user?.uid]);

  return { hasReviewed, reviewedCurrentVersion, isLoading, refetch: check };
}

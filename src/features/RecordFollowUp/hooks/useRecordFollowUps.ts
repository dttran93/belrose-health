// src/features/AddRecord/hooks/useRecordFollowUps.ts

/**
 * useRecordFollowUps
 *
 * Given any FileObject, returns a list of FollowUpItems that still need action.
 * Each item only appears when a real condition on the record is unmet:
 *
 *   - Subject:  fileItem.subjects is empty
 *   - Verify:   current user has no active verification or dispute (async Firestore check)
 *
 * This hook is intentionally decoupled from any UI. Drop it anywhere you render
 * a FileObject and want to surface outstanding actions.
 *
 * Usage:
 *   const { followUpItems, isLoading } = useRecordFollowUps(fileItem, {
 *     onAction: (fileItem) => openReviewPanel(fileItem),
 *   });
 */

import { FileObject } from '@/types/core';
import React, { useEffect, useState } from 'react';
import { FollowUpItem, FollowUpItemId } from '../components/ui/FollowUpItems';
import { useReviewedByCurrentUser } from '@/features/Credibility/hooks/useReviewedByCurrentUser';
import { LinkIcon, ShieldCheck, User, UserX } from 'lucide-react';
import { useInboundRequests } from '@/features/RequestRecord/hooks/useInboundRequests';
import useAuth from '@/features/Auth/hooks/useAuth';
import { useSubjectAlerts } from '@/features/Subject/hooks/useSubjectAlerts';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import SubjectPermissionService from '@/features/Subject/services/subjectPermissionService';
import { PermissionsService } from '@/features/Permissions/services/permissionsService';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface UseRecordFollowUpsOptions {
  refreshKey?: number;
  onAction?: (fileItem: FileObject, itemId: FollowUpItemId) => void;
}

// ─── Return type ─────────────────────────────────────────────────────────────

export interface UseRecordFollowUpsResult {
  followUpItems: FollowUpItem[];
  isLoading: boolean;
  refetch: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRecordFollowUps(
  fileItem: FileObject,
  options: UseRecordFollowUpsOptions = {}
): UseRecordFollowUpsResult {
  const { onAction } = options;

  const isEligible = fileItem.status === 'completed' && (!!fileItem.firestoreId || !!fileItem.id);
  const recordId = fileItem.firestoreId ?? fileItem.id;

  // ── Check 1: Subject ───────────────────────────────────────────────────────

  const [freshSubjects, setFreshSubjects] = useState<string[]>(fileItem.subjects ?? []);
  const [internalRefreshKey, setInternalRefreshKey] = useState(0);

  useEffect(() => {
    if (!isEligible) return;
    const db = getFirestore();
    getDoc(doc(db, 'records', recordId)).then(snap => {
      if (snap.exists()) setFreshSubjects(snap.data().subjects ?? []);
    });
  }, [isEligible, recordId, options?.refreshKey, internalRefreshKey]);

  const hasSubject = freshSubjects.length > 0;

  const {
    hasSubjectRequest, // ← true when current user has a pending incoming consent request
    hasPendingRejectionResponse,
    isLoading: isLoadingAlerts,
    refetch: refetchAlerts,
  } = useSubjectAlerts({ recordId });

  // ── Check 2: Can the current user manage this record? ─────────────────────
  const { user } = useAuth();

  const isSubject = freshSubjects.includes(user?.uid || '');
  // Uses SubjectPermissionService: uploader OR owner OR admin
  const canManageRecord = user ? PermissionsService.canManageRecord(fileItem, user.uid) : false; // ← NEW

  // ── Check 3: Verification ─────────────────────────────────────────────────
  const {
    hasReviewed,
    reviewedCurrentVersion,
    isLoading: isLoadingReview,
    refetch: refetchReview,
  } = useReviewedByCurrentUser(fileItem);

  // ── Check 4: Linked request ───────────────────────────────────────────────
  const {
    requests: inboundRequests,
    loading: isLoadingRequests,
    refresh: refetchRequests,
  } = useInboundRequests();
  const hasPendingRequests = inboundRequests.some(r => r.status === 'pending');

  // ── Build list ────────────────────────────────────────────────────────────

  const isLoading = isEligible && (isLoadingReview || isLoadingRequests || isLoadingAlerts);

  const followUpItems = React.useMemo<FollowUpItem[]>(() => {
    if (!isEligible || isLoading) return [];

    const items: FollowUpItem[] = [];

    // Guests have no wallet — subject/verify actions lead to on-chain writes
    // they can't perform, so only surface "Relate to a request" for them.
    if (user?.isGuest) {
      if (hasPendingRequests) {
        items.push({
          id: 'link-request',
          label: 'Relate to a request',
          subtext: 'You have open requests. Link this record to a relevant request.',
          icon: LinkIcon,
          status: 'pending',
          ctaLabel: 'Link',
          onAction: () => onAction?.(fileItem, 'link-request'),
        });
      }
      return items;
    }

    // Only admins/owners/uploaders can tag a subject
    if (!hasSubject && !hasSubjectRequest && canManageRecord) {
      items.push({
        id: 'subject',
        label: 'Tag a subject',
        subtext:
          'A subject has not been set. Click here to officially link this record to its subject.',
        icon: User,
        status: 'pending',
        ctaLabel: 'Send request',
        onAction: () => onAction?.(fileItem, 'subject'),
      });
    }

    // Current user has been invited as a subject and needs to respond
    if (hasSubjectRequest) {
      items.push({
        id: 'subject-request',
        label: 'Respond to subject request',
        subtext:
          'You have been invited to be the subject of this record. Review and accept or decline.',
        icon: User,
        status: 'pending',
        ctaLabel: 'Respond',
        onAction: () => onAction?.(fileItem, 'subject'),
      });
    }

    if (hasPendingRejectionResponse) {
      items.push({
        id: 'subject-rejection',
        label: 'Respond to subject rejection',
        subtext: 'A subject has declined or removed themselves — review and decide how to proceed',
        icon: UserX,
        status: 'pending',
        ctaLabel: 'Review',
        onAction: () => onAction?.(fileItem, 'subject-rejection'),
      });
    }

    // Only show verification item if user is not the subject (they don't need to verify their own record)
    if (!isSubject) {
      if (!hasReviewed) {
        items.push({
          id: 'verify',
          label: 'Verify this record',
          subtext: 'Confirm the data looks correct',
          icon: ShieldCheck,
          status: 'pending',
          ctaLabel: 'Review',
          onAction: () => onAction?.(fileItem, 'verify'),
        });
      } else if (!reviewedCurrentVersion) {
        items.push({
          id: 'verify',
          label: 'Re-verify this record',
          subtext: 'This record has been edited since your last review',
          icon: ShieldCheck,
          status: 'pending',
          ctaLabel: 'Re-verify',
          onAction: () => onAction?.(fileItem, 'verify'),
        });
      }
    }

    if (hasPendingRequests) {
      items.push({
        id: 'link-request',
        label: 'Relate to a request',
        subtext: 'You have open requests. Link this record to a relevant request.',
        icon: LinkIcon,
        status: 'pending',
        ctaLabel: 'Link',
        onAction: () => onAction?.(fileItem, 'link-request'),
      });
    }

    return items;
  }, [
    isEligible,
    isLoading,
    hasSubject,
    hasSubjectRequest,
    canManageRecord,
    hasPendingRejectionResponse,
    hasReviewed,
    reviewedCurrentVersion,
    hasPendingRequests,
    isSubject,
    fileItem,
    onAction,
    user?.isGuest,
  ]);

  return {
    followUpItems,
    isLoading,
    refetch: () => {
      setInternalRefreshKey(k => k + 1);
      refetchReview();
      refetchAlerts();
      refetchRequests();
    },
  };
}

export default useRecordFollowUps;

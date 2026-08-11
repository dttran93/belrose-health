// src/features/GuestAccess/hooks/useGuestUploadBlocker.ts
//
// Shared navigation-guard logic for guest providers who've uploaded a record but haven't secured
// it yet (claimed a real account, fulfilled it to a pending request, or explicitly left anyway).
// Used by both src/pages/AddRecord.tsx (right after upload) and RecordFull.tsx (reviewing a
// specific record later) — kept agnostic of FileObject/LinkRequestModal specifics so each call
// site supplies its own record-selection glue; this hook only owns the router-blocking +
// request-lookup logic that's identical between them.

import { useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { RecordRequest } from '@belrose/shared';
import { useInboundRequests } from '@/features/RequestRecord/hooks/useInboundRequests';

interface UseGuestUploadBlockerParams {
  isGuest: boolean;
  /** Record IDs this guest may still need to secure (their own uploads). */
  candidateRecordIds: string[];
}

export function useGuestUploadBlocker({ isGuest, candidateRecordIds }: UseGuestUploadBlockerParams) {
  const [showClaimModal, setShowClaimModal] = useState(false);
  const { requests, filtered: pendingRequests, refresh: refreshRequests } = useInboundRequests();

  // Data-driven, not a local "resolved once, stop blocking forever" flag — a record only drops
  // out of this list once a request that actually covers it is confirmed fulfilled. Works
  // identically whether the page just mounted this session or is being freshly loaded on a
  // return visit (RecordDetail has no memory of what AddRecord's session state was).
  const unsecuredRecordIds = candidateRecordIds.filter(
    id => !requests.some(r => r.status === 'fulfilled' && r.fulfilledRecordIds?.includes(id))
  );

  const pendingRequest: RecordRequest | null = isGuest ? (pendingRequests[0] ?? null) : null;

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!isGuest || unsecuredRecordIds.length === 0) return false;
    if (currentLocation.pathname === nextLocation.pathname) return false;
    // Let the guest review any of their own still-unsecured uploads — this is what makes
    // AddRecord -> RecordDetail (and back) navigable without hitting the blocker, since both
    // pages call this same hook.
    const isReviewingOwnUpload = unsecuredRecordIds.some(id =>
      nextLocation.pathname.startsWith(`/app/records/${id}`)
    );
    return !isReviewingOwnUpload;
  });

  const openClaimModal = () => {
    blocker.reset?.();
    setShowClaimModal(true);
  };

  const closeClaimModal = () => setShowClaimModal(false);

  return {
    blocker,
    unsecuredRecordIds,
    pendingRequest,
    refreshRequests,
    showClaimModal,
    openClaimModal,
    closeClaimModal,
  };
}

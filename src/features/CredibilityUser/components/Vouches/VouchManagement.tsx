// src/features/CredibilityUser/components/Vouches/VouchManagement.tsx

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ShieldCheck, ShieldOff, ShieldAlert, Loader2, Plus, X, Clock } from 'lucide-react';
import { UserCard } from '@/features/Users/components/ui/UserCard';
import { UserSearch } from '@/features/Users/components/UserSearch';
import { VouchActionDialog } from './VouchActionDialog';
import { useVouchFlow } from '../../hooks/useVouchFlow';
import { getVouchesGiven, getVouchesReceived } from '../../services/vouchService';
import { getUserProfiles } from '@/features/Users/services/userProfileService';
import { BelroseUserProfile } from '@/types/core';
import { VouchDoc } from '@belrose/shared';
import { Button } from '@/components/ui/Button';

// ============================================================================
// TYPES
// ============================================================================

export interface VouchManagementInitialTarget {
  userId: string;
  displayName: string;
}

interface VouchManagementProps {
  userId: string;
  /**
   * When navigating from a UserCard for a specific user, pass their info here.
   * After vouches load:
   *   - If already actively vouching for them → switches to Given tab so they're visible.
   *   - If not → auto-opens the VouchActionDialog to vouch for them.
   */
  initialTarget?: VouchManagementInitialTarget;
}

interface VouchWithProfile {
  vouch: VouchDoc;
  profile: BelroseUserProfile | null;
}

// ============================================================================
// INITIATE VOUCH FOR USER
// Mounts useVouchFlow for a specific target and auto-opens the dialog.
// ============================================================================

const InitiateVouchForUser: React.FC<{
  targetUserId: string;
  targetDisplayName: string;
  onSuccess: () => void;
  onCancel: () => void;
}> = ({ targetUserId, targetDisplayName, onSuccess, onCancel }) => {
  const flow = useVouchFlow({ targetUserId, targetDisplayName, onSuccess });

  useEffect(() => {
    if (!flow.isLoadingVouch) {
      flow.initiateVouch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.isLoadingVouch]);

  const handleClose = () => {
    flow.reset();
    onCancel();
  };

  return (
    <VouchActionDialog
      isOpen={flow.isDialogOpen}
      phase={flow.phase}
      operationType={flow.operationType}
      targetDisplayName={targetDisplayName}
      error={flow.error}
      onClose={handleClose}
      onConfirmVouch={flow.confirmVouch}
      onConfirmRetract={flow.confirmRetract}
    />
  );
};

// ============================================================================
// ADD VOUCH SEARCH PANEL
// Thin wrapper around UserSearch. Selecting a result triggers InitiateVouchForUser.
// ============================================================================

const AddVouchSearch: React.FC<{
  currentUserId: string;
  activeVoucheeIds: Set<string>;
  onSelectTarget: (target: VouchManagementInitialTarget) => void;
  onClose: () => void;
}> = ({ currentUserId, activeVoucheeIds, onSelectTarget, onClose }) => (
  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-gray-700">Find someone to vouch for</p>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
        <X className="w-4 h-4" />
      </button>
    </div>
    <UserSearch
      excludeUserIds={[currentUserId, ...activeVoucheeIds]}
      placeholder="Search by name, email, or ID…"
      autoFocus
      onUserSelect={user =>
        onSelectTarget({
          userId: user.uid,
          displayName: user.displayName || user.email || user.uid,
        })
      }
    />
  </div>
);

// ============================================================================
// VOUCH ROW (for given vouches — has rescind action)
// ============================================================================

const VouchGivenRow: React.FC<{
  vouchWithProfile: VouchWithProfile;
  onRetractSuccess: () => void;
}> = ({ vouchWithProfile, onRetractSuccess }) => {
  const { vouch, profile } = vouchWithProfile;
  const flow = useVouchFlow({
    targetUserId: vouch.voucheeId,
    targetDisplayName: profile?.displayName || vouch.voucheeId,
    onSuccess: onRetractSuccess,
  });

  const isRetracted = vouch.chainStatus === 'Retracted';
  const isActive = vouch.chainStatus === 'Active';

  return (
    <>
      <UserCard
        user={profile}
        userId={vouch.voucheeId}
        color={isRetracted ? 'red' : isActive ? 'green' : 'yellow'}
        showEmail={false}
        content={
          isRetracted ? (
            <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
              <ShieldOff className="w-3 h-3" />
              Retracted
            </span>
          ) : vouch.chainStatus === 'Failed' ? (
            <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
              <ShieldOff className="w-3 h-3" />
              Failed to confirm — try again
            </span>
          ) : vouch.chainStatus === 'Pending' ? (
            <span className="flex items-center gap-1 text-xs text-yellow-600 font-medium">
              <Clock className="w-3 h-3" />
              Awaiting network confirmation
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-complement-3 font-medium">
              <ShieldCheck className="w-3 h-3" />
              Vouching
            </span>
          )
        }
        additionalItems={
          isActive
            ? [
                {
                  key: 'retract-vouch',
                  label: 'Retract Vouch',
                  icon: ShieldOff,
                  onClick: flow.initiateRetract,
                  destructive: true,
                },
              ]
            : []
        }
      />
      <VouchActionDialog
        isOpen={flow.isDialogOpen}
        phase={flow.phase}
        operationType={flow.operationType}
        targetDisplayName={profile?.displayName || vouch.voucheeId}
        error={flow.error}
        onClose={flow.reset}
        onConfirmVouch={flow.confirmVouch}
        onConfirmRetract={flow.confirmRetract}
      />
    </>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const VouchManagement: React.FC<VouchManagementProps> = ({ userId, initialTarget }) => {
  const [givenVouches, setGivenVouches] = useState<VouchWithProfile[]>([]);
  const [receivedVouches, setReceivedVouches] = useState<VouchWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'given' | 'received'>('given');
  const [showSearch, setShowSearch] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<VouchManagementInitialTarget | null>(null);
  const handledInitialTarget = useRef(false);

  const loadVouches = useCallback(async () => {
    setIsLoading(true);
    try {
      const [given, received] = await Promise.all([
        getVouchesGiven(userId),
        getVouchesReceived(userId),
      ]);

      const givenIds = given.map(v => v.voucheeId);
      const receivedIds = received.map(v => v.voucherId);
      const allIds = [...new Set([...givenIds, ...receivedIds])];

      const profiles = allIds.length > 0 ? await getUserProfiles(allIds) : new Map();

      setGivenVouches(given.map(v => ({ vouch: v, profile: profiles.get(v.voucheeId) ?? null })));
      setReceivedVouches(
        received.map(v => ({ vouch: v, profile: profiles.get(v.voucherId) ?? null }))
      );
    } catch (error) {
      console.error('Error loading vouches:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadVouches();
  }, [loadVouches]);

  // After the first load, handle the initialTarget prop.
  useEffect(() => {
    if (isLoading || !initialTarget || handledInitialTarget.current) return;
    handledInitialTarget.current = true;

    const alreadyVouched = givenVouches.some(
      v => v.vouch.voucheeId === initialTarget.userId && v.vouch.chainStatus !== 'Retracted'
    );

    if (alreadyVouched) {
      // Bring the Given tab into view so the user can see/manage the existing vouch.
      setActiveTab('given');
    } else {
      // Auto-open the vouch dialog for this target.
      setPendingTarget(initialTarget);
    }
    // givenVouches is stable after load; isLoading flip is the reliable trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // "Active" here means "given and not retracted" — Pending/Failed vouches stay visible here
  // (with their own badge, see VouchGivenRow) rather than silently disappearing from the list
  // while the blockchain confirmation is in flight or needs a retry.
  const activeGiven = givenVouches.filter(v => v.vouch.chainStatus !== 'Retracted');
  const retractedGiven = givenVouches.filter(v => v.vouch.chainStatus === 'Retracted');
  const activeReceived = receivedVouches.filter(v => v.vouch.chainStatus === 'Active');
  const activeVoucheeIds = new Set(activeGiven.map(v => v.vouch.voucheeId));

  const handleVouchSuccess = useCallback(() => {
    setPendingTarget(null);
    setShowSearch(false);
    loadVouches();
  }, [loadVouches]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pending vouch dialog (from search or initialTarget) */}
      {pendingTarget && (
        <InitiateVouchForUser
          targetUserId={pendingTarget.userId}
          targetDisplayName={pendingTarget.displayName}
          onSuccess={handleVouchSuccess}
          onCancel={() => setPendingTarget(null)}
        />
      )}

      {/* Tab bar + Add Vouch button */}
      <div className="flex items-center justify-between border-b border-gray-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('given')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'given'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Vouches Given
            {activeGiven.length > 0 && (
              <span className="ml-2 bg-complement-3/20 text-complement-3 text-xs rounded-full px-2 py-0.5">
                {activeGiven.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('received')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'received'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Vouches Received
            {activeReceived.length > 0 && (
              <span className="ml-2 bg-complement-3/20 text-complement-3 text-xs rounded-full px-2 py-0.5">
                {activeReceived.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'given' && (
          <Button className="m-2" onClick={() => setShowSearch(s => !s)}>
            <Plus className="w-4 h-4" />
            Add Vouch
          </Button>
        )}
      </div>

      {/* Search panel */}
      {activeTab === 'given' && showSearch && (
        <AddVouchSearch
          currentUserId={userId}
          activeVoucheeIds={activeVoucheeIds}
          onSelectTarget={target => {
            setShowSearch(false);
            setPendingTarget(target);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Given tab */}
      {activeTab === 'given' && (
        <div className="space-y-6">
          {givenVouches.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="w-8 h-8 text-gray-300" />}
              message="You haven't vouched for anyone yet."
            />
          ) : (
            <>
              {activeGiven.length > 0 && (
                <Section title="Active">
                  {activeGiven.map(v => (
                    <VouchGivenRow
                      key={v.vouch.id}
                      vouchWithProfile={v}
                      onRetractSuccess={loadVouches}
                    />
                  ))}
                </Section>
              )}
              {retractedGiven.length > 0 && (
                <Section title="Retracted">
                  {retractedGiven.map(v => (
                    <VouchGivenRow
                      key={v.vouch.id}
                      vouchWithProfile={v}
                      onRetractSuccess={loadVouches}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* Received tab */}
      {activeTab === 'received' && (
        <div className="space-y-4">
          {activeReceived.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="w-8 h-8 text-gray-300" />}
              message="No one has vouched for you yet."
            />
          ) : (
            activeReceived.map(({ vouch, profile }) => (
              <UserCard
                key={vouch.id}
                user={profile}
                userId={vouch.voucherId}
                color="green"
                showEmail={false}
                content={
                  <span className="flex items-center gap-1 text-xs text-complement-3 font-medium">
                    <ShieldCheck className="w-3 h-3" />
                    Vouched for you
                  </span>
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SMALL HELPERS
// ============================================================================

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
    {children}
  </div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; message: string }> = ({ icon, message }) => (
  <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
    {icon}
    <p className="text-sm">{message}</p>
  </div>
);

export default VouchManagement;

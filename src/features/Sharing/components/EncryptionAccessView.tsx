// src/features/Sharing/components/EncryptionAccessView.tsx

import React, { useState, useEffect } from 'react';
import { Key, XCircle, Plus, View, ArrowLeft } from 'lucide-react';
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { getUserProfiles } from '@/features/Users/services/userProfileService';
import { FileObject, BelroseUserProfile } from '@/types/core';
import UserCard from '@/features/Users/components/ui/UserCard';
import { Button } from '@/components/ui/Button';
import { usePermissionFlow } from '@/features/Permissions/hooks/usePermissionFlow';
import { PermissionActionDialog } from '@/features/Permissions/components/ui/PermissionActionDialog';
import UserSearch from '@/features/Users/components/UserSearch';
import type { Role } from '@/features/Permissions/services/permissionsService';
import AccessUserCard from './ui/AccessUserCard';
import RecordSectionPanel from '@/components/ui/RecordSectionPanel';
import useAuth from '@/features/Auth/hooks/useAuth';
import { GuestSharePanel } from '../../GuestAccess/components/GuestSharePanel';
import {
  deriveAccessEntries,
  type WrappedKeyInfo,
  type AccessEntry,
} from '../services/accessEntries';

export type { AccessEntry, WrappedKeyInfo };

interface EncryptionAccessViewProps {
  record: FileObject;
  onBack?: () => void;
  onSuccess?: () => void;
}

export const EncryptionAccessView: React.FC<EncryptionAccessViewProps> = ({
  record,
  onBack,
  onSuccess,
}) => {
  const { user } = useAuth();
  const [accessEntries, setAccessEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUserSearchOpen, setIsUserSearchOpen] = useState(false);
  const [selectedUserForGrant, setSelectedUserForGrant] = useState<BelroseUserProfile | null>(null);
  const patientName = user?.displayName || user?.email || 'A Belrose user';
  const isGuest = user?.isGuest || false;

  const {
    dialogProps,
    initiateRevoke,
    initiateGrant,
    isLoading: isActionLoading,
  } = usePermissionFlow({
    recordId: record.id,
    recordTitle: (record.belroseFields?.title || record.fileName) ?? undefined,
    onSuccess: () => {
      fetchEncryptionAccess();
      onSuccess?.();
    },
  });

  const fetchEncryptionAccess = async () => {
    if (!record.id) return;
    setLoading(true);
    try {
      const db = getFirestore();

      const recordSnap = await getDoc(doc(db, 'records', record.id));
      const latestRecord = recordSnap.exists() ? (recordSnap.data() as FileObject) : record;

      const querySnapshot = await getDocs(
        query(collection(db, 'wrappedKeys'), where('recordId', '==', record.id))
      );

      const wrappedKeys: WrappedKeyInfo[] = querySnapshot.docs.map(
        doc => ({ ...doc.data(), createdAt: doc.data().createdAt?.toDate() }) as WrappedKeyInfo
      );

      const allUserIds = new Set<string>([
        ...wrappedKeys.map(wk => wk.userId),
        ...(latestRecord.owners || []),
        ...(latestRecord.administrators || []),
        ...(latestRecord.sharers || []),
        ...(latestRecord.viewers || []),
        ...(latestRecord.subjects || []),
      ]);

      const profiles = await getUserProfiles(Array.from(allUserIds));

      setAccessEntries(deriveAccessEntries(wrappedKeys, latestRecord, profiles));
    } catch (err) {
      console.error(err);
      setError('Failed to load access data. Only Owners and Administrators can Manage Access');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEncryptionAccess();
  }, [record.id, record.owners, record.administrators, record.viewers]);

  const issueCount = accessEntries.filter(
    e => e.status !== 'synced' && e.status !== 'inactive'
  ).length;
  const activeKeyCount = accessEntries.filter(e => e.wrappedKey?.isActive).length;

  /**
   * Handle delete/revoke button click on a user card
   * Initiates the revoke flow with the permission dialog
   */
  const handleRevokeClick = (entry: AccessEntry) => {
    if (entry.role === 'none' || !entry.profile) return;
    initiateRevoke(entry.profile, entry.role as Role);
  };

  /**
   * Handle grant button click - initiates grant with role selection
   */
  const handleGrantAccess = () => {
    if (!selectedUserForGrant) return;
    // Use 'select-role' variant so user can choose the role in the dialog
    initiateGrant(selectedUserForGrant, 'viewer', 'select-role');
    // Clear selection and close search
    setSelectedUserForGrant(null);
    setIsUserSearchOpen(false);
  };

  /**
   * Cancel adding a user
   */
  const handleCancelGrant = () => {
    setSelectedUserForGrant(null);
    setIsUserSearchOpen(false);
  };

  const tooltipContent = (
    <>
      <p className="font-semibold mb-2 text-sm">Encryption Access Overview</p>
      <p className="text-xs mb-3">
        This view shows who has cryptographic access to decrypt this record, cross-referenced with
        their permission roles.
      </p>
      <ol className="list-decimal list-inside space-y-1 text-xs">
        <li>
          <strong>Synced:</strong> User has both a role and can decrypt
        </li>
        <li>
          <strong>Missing Key:</strong> Has role but can't decrypt (re-grant to fix)
        </li>
        <li>
          <strong>Orphaned Key:</strong> Can decrypt but has no role (security issue)
        </li>
        <li>
          <strong>Inactive:</strong> Access has not been activated or was revoked
        </li>
      </ol>
    </>
  );

  return (
    <div className="w-full mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <View className="w-5 h-5" />
          Manage Access
        </h3>
        <Button onClick={onBack} className="w-8 h-8 border-none bg-transparent hover:bg-gray-200">
          <ArrowLeft className="text-primary" />
        </Button>
      </div>

      <RecordSectionPanel
        icon={<Key className="w-5 h-5 text-gray-700" />}
        title="Encrypted Access"
        badges={[
          {
            label: String(activeKeyCount),
            className: 'border border-primary bg-primary/20 text-primary',
          },
          ...(issueCount > 0
            ? [
                {
                  label: `${issueCount} issue${issueCount > 1 ? 's' : ''}`,
                  className: 'border border-red-700 bg-red-100 text-red-800',
                },
              ]
            : []),
        ]}
        tooltipLabel="Encrypted Access"
        tooltipClassName="border border-primary bg-primary/20 text-primary"
        tooltipContent={tooltipContent}
        headerAction={
          !isGuest && (
            <button
              className="rounded-full hover:bg-gray-200 p-1 transition-colors"
              onClick={() => setIsUserSearchOpen(!isUserSearchOpen)}
            >
              <Plus className="w-5 h-5" />
            </button>
          )
        }
        isLoading={loading}
        loadingLabel="Loading encryption access..."
        errorState={
          error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800">{error}</p>
            </div>
          ) : undefined
        }
        isEmpty={accessEntries.length === 0}
        emptyState={
          <div className="flex justify-center items-center py-8">
            <p className="text-gray-600">No encryption access found</p>
          </div>
        }
      >
        {accessEntries.map(entry => (
          <AccessUserCard
            key={entry.userId}
            entry={entry}
            record={record}
            onDelete={
              !isGuest && entry.role !== 'none' && entry.profile
                ? () => handleRevokeClick(entry)
                : undefined
            }
          />
        ))}
      </RecordSectionPanel>

      {/* User Search for Granting Access */}
      {isUserSearchOpen && (
        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900">Grant Access</h4>
            <button onClick={handleCancelGrant} className="text-gray-400 hover:text-gray-600">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <UserSearch
            onUserSelect={user => setSelectedUserForGrant(user)}
            excludeUserIds={accessEntries.filter(e => e.wrappedKey?.isActive).map(e => e.userId)}
            placeholder="Search by name, email, or user ID..."
          />
          {selectedUserForGrant && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-3">Grant access to this user:</p>
              <UserCard
                user={selectedUserForGrant}
                userId={selectedUserForGrant.uid}
                onViewUser={() => {}}
                variant="default"
                color="green"
                menuType="cancel"
                onCancel={() => setSelectedUserForGrant(null)}
              />
              <Button
                onClick={handleGrantAccess}
                disabled={isActionLoading}
                className="w-full mt-3"
              >
                {isActionLoading ? 'Processing...' : 'Select Role & Grant Access'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Permission Action Dialog - handles preparation, confirmation, and execution */}
      <PermissionActionDialog {...dialogProps} />

      {!isGuest && (
        <GuestSharePanel
          record={record}
          patientName={patientName}
          onSuccess={fetchEncryptionAccess}
        />
      )}
    </div>
  );
};

export default EncryptionAccessView;

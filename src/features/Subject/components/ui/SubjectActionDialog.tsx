// src/features/Subject/components/ui/SubjectActionDialog.tsx

/**
 * SubjectActionDialog
 *
 * Unified modal dialog for all subject operations:
 * - Adding subjects (self or others) with selection/search phases
 * - Accepting/rejecting subject requests
 * - Removing subject status
 *
 * Phases:
 * - selecting: Choose self vs other, role selection
 * - searching: User search for "other" flow
 * - preparing: Wallet setup with progress
 * - confirming: Final confirmation
 * - executing: Operation in progress
 * - success: Operation completed
 * - error: Operation failed
 */

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import {
  User,
  Users,
  UserCheck,
  UserMinus,
  UserX,
  Loader2,
  XCircle,
  AlertTriangle,
  Link,
  Unlink,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Crown,
  ArrowLeft,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';
import type {
  SubjectOperationType,
  SubjectPreparationProgress,
} from '../../services/subjectPreparationService';
import type { SubjectDialogPhase, SubjectRole, SubjectChoice } from '../../hooks/useSubjectFlow';
import { getUserRoleForRecord, getMinimumAllowedRole } from '../../hooks/useSubjectFlow';
import { FileObject, BelroseUserProfile } from '@/types/core';
import UserSearch from '@/features/Users/components/UserSearch';
import UserCard from '@/features/Users/components/ui/UserCard';
import { useAuthContext } from '@/features/Auth/AuthContext';
import { REJECTION_REASON_OPTIONS } from '../../services/subjectRejectionService';
import NetworkPreparingContent from '@/features/BlockchainWallet/components/NetworkPreparingContent';
import RequesterSuggestions from '@/features/RequestRecord/components/ui/RequesterSuggestions';
import { OnChainSubmittedContent } from '@/features/OnChainActivityTray/components/OnChainSubmittedModal';
import { RejectionReasons, VerificationLevelOptions } from '@belrose/shared';
import { VERIFICATION_OPTIONS } from '@/features/CredibilityRecord/services/verificationService';

// ============================================================================
// TYPES
// ============================================================================

interface SubjectActionDialogProps {
  isOpen: boolean;
  phase: SubjectDialogPhase;
  operationType: SubjectOperationType;
  error?: string | null;
  preparationProgress?: SubjectPreparationProgress | null;
  // Selection state
  subjectChoice: SubjectChoice;
  setSubjectChoice: (choice: SubjectChoice) => void;
  selectedRole: SubjectRole;
  setSelectedRole: (role: SubjectRole) => void;
  selectedUser: BelroseUserProfile | null;
  setSelectedUser: (user: BelroseUserProfile | null) => void;
  revokeAccess: boolean;
  setRevokeAccess: (value: boolean) => void;
  // Record info
  record: FileObject;
  currentSubjects: string[];
  isSubject: boolean;
  // Controller-anchor state
  isControllerOfSelected: boolean;
  controllerTrustorIds: Set<string>;
  // Callbacks
  onClose: () => void;
  onProceedFromSelection: () => void;
  onSelectUser: (user: BelroseUserProfile) => void;
  onGoBackToSelection: () => void;
  onGoBackToSearching: () => void;
  onConfirmSetSubjectAsSelf: () => void;
  onConfirmRequestConsent: (verifyLevel?: VerificationLevelOptions) => void;
  onConfirmAnchorSubjectAsController: () => void;
  onConfirmAcceptRequest: () => void;
  onConfirmRejectRequest: (reason: RejectionReasons) => void;
  onConfirmRemoveSubjectStatus: (reason: RejectionReasons) => void;
  submittedLabel: string;
  zIndex?: { overlay: number; content: number };
}

// Role configuration for display
const ROLE_CONFIG: Record<
  SubjectRole,
  {
    label: string;
    description: string;
    icon: React.ElementType;
    color: string;
    borderColor: string;
    bgColor: string;
  }
> = {
  sharer: {
    label: 'Sharer',
    description: 'Can view and share the record, but cannot edit it',
    icon: Share2,
    color: 'text-green-600',
    borderColor: 'border-green-200',
    bgColor: 'bg-green-50',
  },
  administrator: {
    label: 'Administrator',
    description: 'Can view, edit, share, and manage the record',
    icon: ShieldCheck,
    color: 'text-blue-600',
    borderColor: 'border-blue-200',
    bgColor: 'bg-blue-50',
  },
  owner: {
    label: 'Owner',
    description: 'Full control including deletion and adding other owners',
    icon: Crown,
    color: 'text-amber-600',
    borderColor: 'border-amber-200',
    bgColor: 'bg-amber-50',
  },
};

const ROLE_HIERARCHY: Record<SubjectRole, number> = {
  sharer: 1,
  administrator: 2,
  owner: 3,
};

// ============================================================================
// COMPONENT
// ============================================================================

export const SubjectActionDialog: React.FC<SubjectActionDialogProps> = ({
  isOpen,
  phase,
  operationType,
  error,
  preparationProgress,
  subjectChoice,
  setSubjectChoice,
  selectedRole,
  setSelectedRole,
  selectedUser,
  setSelectedUser,
  revokeAccess,
  setRevokeAccess,
  record,
  currentSubjects,
  isSubject,
  isControllerOfSelected,
  controllerTrustorIds,
  onClose,
  onProceedFromSelection,
  onSelectUser,
  onGoBackToSelection,
  onGoBackToSearching,
  onConfirmSetSubjectAsSelf,
  onConfirmRequestConsent,
  onConfirmAnchorSubjectAsController,
  onConfirmAcceptRequest,
  onConfirmRejectRequest,
  onConfirmRemoveSubjectStatus,
  submittedLabel,
  zIndex = { overlay: 100, content: 101 },
}) => {
  const { user } = useAuthContext();

  if (!isOpen) return null;

  const canClose =
    phase === 'selecting' ||
    phase === 'searching' ||
    phase === 'confirming' ||
    phase === 'error' ||
    phase === 'submitted';

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={open => !open && canClose && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          style={{ zIndex: zIndex.overlay }}
        />
        <AlertDialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl p-6 shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          style={{ zIndex: zIndex.content }}
        >
          {/* Selecting Phase */}
          {phase === 'selecting' && (
            <SelectingContent
              record={record}
              currentSubjects={currentSubjects}
              isSubject={isSubject}
              subjectChoice={subjectChoice}
              setSubjectChoice={setSubjectChoice}
              selectedRole={selectedRole}
              setSelectedRole={setSelectedRole}
              onProceed={onProceedFromSelection}
              onClose={onClose}
            />
          )}

          {/* Searching Phase */}
          {phase === 'searching' && (
            <SearchingContent
              record={record}
              currentSubjects={currentSubjects}
              selectedRole={selectedRole}
              controllerTrustorIds={controllerTrustorIds}
              onSelectUser={onSelectUser}
              onGoBack={onGoBackToSelection}
              onClose={onClose}
            />
          )}

          {/* Preparing Phase */}
          {phase === 'preparing' && (
            <NetworkPreparingContent
              progress={preparationProgress}
              steps={['computing', 'saving', 'registering', 'initializing_record']}
            />
          )}

          {/* Executing Phase */}
          {phase === 'executing' && <ExecutingContent operationType={operationType} />}

          {/* Error Phase */}
          {phase === 'error' && <ErrorContent error={error} onClose={onClose} />}

          {/* Confirming Phase - Set Self as Subject */}
          {phase === 'confirming' && operationType === 'setSubjectAsSelf' && (
            <ConfirmSetSubjectAsSelfContent
              record={record}
              selectedRole={selectedRole}
              onConfirm={onConfirmSetSubjectAsSelf}
            />
          )}

          {/* Confirming Phase - Request Consent (non-controller path) */}
          {phase === 'confirming' &&
            selectedUser &&
            subjectChoice === 'other' &&
            !isControllerOfSelected && (
              <ConfirmRequestConsentContent
                record={record}
                selectedUser={selectedUser}
                selectedRole={selectedRole}
                onConfirm={onConfirmRequestConsent}
                onGoBack={onGoBackToSearching}
                onClose={onClose}
              />
            )}

          {/* Confirming Phase - Controller Anchor (no consent needed) */}
          {phase === 'confirming' &&
            selectedUser &&
            subjectChoice === 'other' &&
            isControllerOfSelected && (
              <ConfirmAnchorSubjectContent
                record={record}
                selectedUser={selectedUser}
                onConfirm={onConfirmAnchorSubjectAsController}
                onGoBack={onGoBackToSearching}
                onClose={onClose}
              />
            )}

          {/* Confirming Phase - Accept Subject Request */}
          {phase === 'confirming' && operationType === 'acceptSubjectRequest' && !selectedUser && (
            <ConfirmAcceptRequestContent record={record} onConfirm={onConfirmAcceptRequest} />
          )}

          {/* Confirming Phase - Reject Subject Request */}
          {phase === 'confirming' && operationType === 'rejectSubjectRequest' && (
            <ConfirmRejectRequestContent
              record={record}
              onConfirm={(reason: RejectionReasons) => onConfirmRejectRequest(reason)}
            />
          )}

          {/* Confirming Phase - Remove Subject Status */}
          {phase === 'confirming' && operationType === 'rejectSubjectStatus' && (
            <ConfirmRemoveSubjectStatusContent
              record={record}
              revokeAccess={revokeAccess}
              setRevokeAccess={setRevokeAccess}
              onConfirm={(reason: RejectionReasons) => onConfirmRemoveSubjectStatus(reason)}
            />
          )}

          {phase === 'submitted' && (
            <OnChainSubmittedContent
              onClose={onClose} // onClose calls reset() in the hook
              label={submittedLabel}
            />
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};

// ============================================================================
// SELECTING PHASE CONTENT
// ============================================================================

const SelectingContent: React.FC<{
  record: FileObject;
  currentSubjects: string[];
  isSubject: boolean;
  subjectChoice: SubjectChoice;
  setSubjectChoice: (choice: SubjectChoice) => void;
  selectedRole: SubjectRole;
  setSelectedRole: (role: SubjectRole) => void;
  onProceed: () => void;
  onClose: () => void;
}> = ({
  record,
  currentSubjects,
  isSubject,
  subjectChoice,
  setSubjectChoice,
  selectedRole,
  setSelectedRole,
  onProceed,
  onClose,
}) => {
  const { user } = useAuthContext();
  const userCurrentRole = user?.uid ? getUserRoleForRecord(user.uid, record) : null;
  const minimumRole = user?.uid ? getMinimumAllowedRole(user.uid, record) : 'sharer';
  const minimumRoleLevel = ROLE_HIERARCHY[minimumRole];

  // Filter roles based on user's current role (for self)
  const allowedRoles = (Object.keys(ROLE_CONFIG) as SubjectRole[]).filter(role => {
    if (subjectChoice === 'self') {
      return ROLE_HIERARCHY[role] >= minimumRoleLevel;
    }
    return true;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
          <User className="w-5 h-5" />
          Set Record Subject
        </AlertDialog.Title>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        Who is this record about?
      </AlertDialog.Description>

      {/* Subject Choice */}
      <div className="space-y-2 mb-4">
        {/* Self Option */}
        <label
          className={`
            flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
            ${isSubject ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}
            ${subjectChoice === 'self' && !isSubject ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}
          `}
        >
          <input
            type="radio"
            name="subjectChoice"
            value="self"
            checked={subjectChoice === 'self'}
            onChange={() => setSubjectChoice('self')}
            disabled={isSubject}
            className="w-4 h-4 text-blue-600"
          />
          <User className="w-5 h-5 text-gray-600" />
          <div className="flex-1">
            <p className="font-medium text-gray-900">This record is about me</p>
            <p className="text-xs text-gray-500">
              {isSubject
                ? 'You are already set as a subject'
                : 'You will be immediately added as the subject'}
            </p>
          </div>
        </label>

        {/* Other Person Option */}
        <label
          className={`
            flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
            ${subjectChoice === 'other' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}
          `}
        >
          <input
            type="radio"
            name="subjectChoice"
            value="other"
            checked={subjectChoice === 'other'}
            onChange={() => setSubjectChoice('other')}
            className="w-4 h-4 text-blue-600"
          />
          <Users className="w-5 h-5 text-gray-600" />
          <div className="flex-1">
            <p className="font-medium text-gray-900">This record is about someone else</p>
            <p className="text-xs text-gray-500">They will need to confirm before being added</p>
          </div>
        </label>
      </div>

      {/* Role Selection */}
      <div className="mb-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Select access level:</p>
        <div className="space-y-2">
          {allowedRoles.map(role => {
            const config = ROLE_CONFIG[role];
            const Icon = config.icon;
            const isSelected = selectedRole === role;

            return (
              <label
                key={role}
                className={`
                  flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                  ${isSelected ? `${config.borderColor} ${config.bgColor}` : 'border-gray-200 hover:border-gray-300'}
                `}
              >
                <input
                  type="radio"
                  name="roleChoice"
                  value={role}
                  checked={isSelected}
                  onChange={() => setSelectedRole(role)}
                  className="w-4 h-4 text-blue-600"
                />
                <Icon className={`w-5 h-5 ${config.color}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{config.label}</p>
                    {subjectChoice === 'self' && userCurrentRole === role && (
                      <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{config.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        {subjectChoice === 'self' && userCurrentRole && userCurrentRole !== 'sharer' && (
          <p className="text-xs text-gray-500 mt-2 italic">
            Lower permission levels are not shown to prevent downgrading.
          </p>
        )}
      </div>

      {/* Blockchain Info (for self) */}
      {subjectChoice === 'self' && !isSubject && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex gap-2">
          <Link className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-900">Record Anchoring</p>
            <p className="text-xs mt-1 text-blue-800">
              Your subject status will be recorded on the distributed network for verification.
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-3">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <Button
          onClick={onProceed}
          disabled={subjectChoice === 'self' && isSubject}
          className="flex-1"
        >
          {subjectChoice === 'self' ? 'Continue' : 'Search Users'}
        </Button>
      </div>
    </div>
  );
};

// ============================================================================
// SEARCHING PHASE CONTENT
// ============================================================================

const SearchingContent: React.FC<{
  record: FileObject;
  currentSubjects: string[];
  selectedRole: SubjectRole;
  controllerTrustorIds: Set<string>;
  onSelectUser: (user: BelroseUserProfile) => void;
  onGoBack: () => void;
  onClose: () => void;
}> = ({
  record,
  currentSubjects,
  selectedRole,
  controllerTrustorIds,
  onSelectUser,
  onGoBack,
  onClose,
}) => {
  const { user } = useAuthContext();

  const handleUserSelect = (u: BelroseUserProfile) => {
    onSelectUser(u);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={onGoBack} className="p-1 rounded hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Search for Subject
          </AlertDialog.Title>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        Search for the person this record is about. They will need to accept your request.
      </AlertDialog.Description>

      {/* User Search */}
      <div className="mb-4">
        <RequesterSuggestions
          onSelectUser={onSelectUser}
          excludeUserIds={[...currentSubjects, user?.uid || '']}
        />
        <UserSearch
          onUserSelect={handleUserSelect}
          excludeUserIds={[...currentSubjects, user?.uid || '']}
          placeholder="Search by name, email, or user ID..."
          autoFocus
          renderCardContent={u =>
            controllerTrustorIds.has(u.uid) ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-red-50 border-red-200 text-red-600">
                <ShieldAlert className="w-3 h-3" />
                Controller
              </span>
            ) : null
          }
        />
      </div>

      {/* Role Badge */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <p className="text-xs text-gray-500 mb-1">Access Level</p>
        <div className="flex items-center gap-2">
          {(() => {
            const config = ROLE_CONFIG[selectedRole];
            const Icon = config.icon;
            return (
              <>
                <Icon className={`w-4 h-4 ${config.color}`} />
                <span className="font-medium">{config.label}</span>
              </>
            );
          })()}
        </div>
      </div>

      {/* Consent Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-900">Consent Required</p>
          <p className="text-xs mt-1 text-amber-800">
            The selected user will receive record access and a notification. They must accept before
            they are added as subject.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onGoBack}>
          Back
        </Button>
        <Button disabled className="flex-1">
          Send Request
        </Button>
      </div>
    </div>
  );
};

// ============================================================================
// PHASE CONTENT COMPONENTS
// ============================================================================

const ExecutingContent: React.FC<{ operationType: SubjectOperationType }> = ({ operationType }) => {
  const messages: Record<SubjectOperationType, string> = {
    setSubjectAsSelf: 'Linking you to this record...',
    requestSubjectConsent: 'Sending subject request...',
    acceptSubjectRequest: 'Accepting subject request...',
    rejectSubjectRequest: 'Declining subject request...',
    rejectSubjectStatus: 'Removing your subject status...',
    removeSubjectByOwner: 'Removing subject from record...',
  };

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      <AlertDialog.Title className="text-lg font-bold text-center">Processing</AlertDialog.Title>
      <AlertDialog.Description className="text-sm text-gray-600 text-center">
        {messages[operationType] || 'Processing your request...'}
      </AlertDialog.Description>
    </div>
  );
};

const ErrorContent: React.FC<{ error?: string | null; onClose: () => void }> = ({
  error,
  onClose,
}) => (
  <div className="flex flex-col items-center gap-4 py-8">
    <XCircle className="w-10 h-10 text-red-500" />
    <AlertDialog.Title className="text-lg font-bold text-center text-red-600">
      Something went wrong
    </AlertDialog.Title>
    <AlertDialog.Description className="text-sm text-gray-600 text-center">
      {error || 'An unexpected error occurred. Please try again.'}
    </AlertDialog.Description>
    <Button onClick={onClose} variant="outline" className="mt-2">
      Close
    </Button>
  </div>
);

// ============================================================================
// CONFIRM CONTENT COMPONENTS
// ============================================================================

const ConfirmSetSubjectAsSelfContent: React.FC<{
  record: FileObject;
  selectedRole: SubjectRole;
  onConfirm: () => void;
}> = ({ record, selectedRole, onConfirm }) => {
  const roleConfig = ROLE_CONFIG[selectedRole];
  const RoleIcon = roleConfig.icon;

  return (
    <div>
      <AlertDialog.Title className="text-lg font-bold flex items-center gap-2 mb-3">
        <UserCheck className="w-5 h-5 text-blue-500" />
        Confirm Subject Status
      </AlertDialog.Title>

      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        You are about to declare yourself as the subject of this record.
      </AlertDialog.Description>

      {/* Record Info */}
      <div className="p-3 border rounded-lg bg-gray-50 mb-4">
        <p className="text-xs text-gray-500 mb-1">Record</p>
        <p className="font-medium text-gray-900">
          {record.belroseFields?.title || record.fileName || 'Untitled Record'}
        </p>
      </div>

      {/* Role Info */}
      <div className={`p-3 border rounded-lg ${roleConfig.bgColor} ${roleConfig.borderColor} mb-4`}>
        <p className="text-xs text-gray-500 mb-1">Access Level</p>
        <div className="flex items-center gap-2">
          <RoleIcon className={`w-5 h-5 ${roleConfig.color}`} />
          <span className="font-medium">{roleConfig.label}</span>
        </div>
      </div>

      {/* Info Card */}
      <div className="p-4 border rounded-lg bg-amber-50 border-amber-200 mb-4">
        <div className="flex gap-3">
          <Link className="w-5 h-5 text-amber-800 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-amber-800">What this means</p>
            <ul className="mt-2 text-sm text-amber-800 space-y-1">
              <li>• This record is about you</li>
              <li>• You're also verifying that its contents are accurate</li>
              <li>• Both will be recorded on the distributed network</li>
              <li>• You can remove your link or verification at any time</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <Button onClick={onConfirm} className="flex-1">
          Confirm
        </Button>
      </div>
    </div>
  );
};

const ConfirmAnchorSubjectContent: React.FC<{
  record: FileObject;
  selectedUser: BelroseUserProfile;
  onConfirm: () => void;
  onGoBack: () => void;
  onClose: () => void;
}> = ({ record, selectedUser, onConfirm, onGoBack, onClose }) => (
  <div>
    <AlertDialog.Title className="text-lg font-bold flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-red-600" />
        Anchor Subject as Controller
      </div>
      <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
        <X className="w-5 h-5 text-gray-500" />
      </button>
    </AlertDialog.Title>

    <AlertDialog.Description className="text-sm text-gray-600 mb-4">
      You are anchoring{' '}
      <strong>{selectedUser.displayName || selectedUser.email || 'this user'}</strong> as the
      subject of this record using your controller trustee authority.
    </AlertDialog.Description>

    {/* User Info */}
    <div className="mb-4">
      <p className="text-xs text-gray-500 mb-2">Subject</p>
      <UserCard
        user={selectedUser}
        variant="compact"
        color="primary"
        menuType="none"
        content={
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-red-50 border-red-200 text-red-600">
            <ShieldAlert className="w-3 h-3" />
            Controller
          </span>
        }
      />
    </div>

    {/* Record Info */}
    <div className="p-3 border rounded-lg bg-gray-50 mb-4">
      <p className="text-xs text-gray-500 mb-1">Record</p>
      <p className="font-medium text-gray-900">
        {record.belroseFields?.title || record.fileName || 'Untitled Record'}
      </p>
    </div>

    {/* Info Note */}
    <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
      <p className="text-xs text-red-800 leading-relaxed">
        As their controller trustee, you can anchor them as subject directly — no consent request
        needed. Their subject link will be recorded on the distributed network, and{' '}
        <strong>you</strong> will be recorded as verifying the record's contents on their behalf.
      </p>
    </div>

    <div className="flex gap-3">
      <Button variant="outline" className="flex-1" onClick={onGoBack}>
        Back
      </Button>
      <Button onClick={onConfirm} className="flex-1 bg-red-600 hover:bg-red-700">
        Anchor Subject
      </Button>
    </div>
  </div>
);

const ConfirmRequestConsentContent: React.FC<{
  record: FileObject;
  selectedUser: BelroseUserProfile;
  selectedRole: SubjectRole;
  onConfirm: (verifyLevel?: VerificationLevelOptions) => void;
  onGoBack: () => void;
  onClose: () => void;
}> = ({ record, selectedUser, selectedRole, onConfirm, onGoBack, onClose }) => {
  const roleConfig = ROLE_CONFIG[selectedRole];
  const RoleIcon = roleConfig.icon;
  // Defaults to Provenance — matches "provider creates and verifies, then requests patient
  // anchor" from the whitepaper. 0 = no verification.
  const [verifyLevel, setVerifyLevel] = useState<VerificationLevelOptions | 0>(1);

  return (
    <div>
      <AlertDialog.Title className="text-lg font-bold flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-500" />
          Send Subject Request
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </AlertDialog.Title>

      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        You are about to request that this user confirm they are the subject of this record.
      </AlertDialog.Description>

      {/* User Info */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Requesting</p>
        <UserCard user={selectedUser} variant="compact" color="primary" />
      </div>

      {/* Record Info */}
      <div className="p-3 border rounded-lg bg-gray-50 mb-4">
        <p className="text-xs text-gray-500 mb-1">Record</p>
        <p className="font-medium text-gray-900">
          {record.belroseFields?.title || record.fileName || 'Untitled Record'}
        </p>
      </div>

      {/* Role Info */}
      <div className={`p-3 border rounded-lg ${roleConfig.bgColor} ${roleConfig.borderColor} mb-4`}>
        <p className="text-xs text-gray-500 mb-1">Access Level</p>
        <div className="flex items-center gap-2">
          <RoleIcon className={`w-5 h-5 ${roleConfig.color}`} />
          <span className="font-medium">{roleConfig.label}</span>
        </div>
      </div>

      {/* Your Verification */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Your verification of this record
        </label>
        <select
          value={verifyLevel}
          onChange={e => setVerifyLevel(Number(e.target.value) as VerificationLevelOptions | 0)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
        >
          <option value={0}>No verification</option>
          {VERIFICATION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {verifyLevel === 0
            ? "You won't be recorded as verifying this record's content or origin."
            : VERIFICATION_OPTIONS.find(o => o.value === verifyLevel)?.description}
        </p>
      </div>

      {/* Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-600 leading-relaxed">
          The user will receive record access but must accept before being added as a subject. Their
          acceptance will be recorded on the distributed network.
        </p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onGoBack}>
          Back
        </Button>
        <Button onClick={() => onConfirm(verifyLevel || undefined)} className="flex-1">
          Send Request
        </Button>
      </div>
    </div>
  );
};

const ConfirmAcceptRequestContent: React.FC<{
  record: FileObject;
  onConfirm: () => void;
}> = ({ record, onConfirm }) => (
  <div>
    <AlertDialog.Title className="text-lg font-bold flex items-center gap-2 mb-3">
      <UserCheck className="w-5 h-5 text-green-500" />
      Accept Subject Request
    </AlertDialog.Title>

    <AlertDialog.Description className="text-sm text-gray-600 mb-4">
      Someone has requested that you confirm you are the subject of this record.
    </AlertDialog.Description>

    {/* Record Info */}
    <div className="p-3 border rounded-lg bg-gray-50 mb-4">
      <p className="text-xs text-gray-500 mb-1">Record</p>
      <p className="font-medium text-gray-900">
        {record.belroseFields?.title || record.fileName || 'Untitled Record'}
      </p>
    </div>

    {/* Info Card */}
    <div className="p-4 border rounded-lg bg-green-50 border-green-200 mb-4">
      <div className="flex gap-3">
        <Link className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-green-900">By accepting, you confirm:</p>
          <ul className="mt-2 text-sm text-green-800 space-y-1">
            <li>• This record is about you</li>
            <li>• You consent to being linked to this record</li>
            <li>• You're also verifying that its contents are accurate</li>
            <li>• All of this will be recorded on network</li>
          </ul>
        </div>
      </div>
    </div>

    <div className="flex gap-3">
      <AlertDialog.Cancel asChild>
        <Button variant="outline" className="flex-1">
          Cancel
        </Button>
      </AlertDialog.Cancel>
      <Button onClick={onConfirm} className="flex-1 bg-green-600 hover:bg-green-700">
        Accept
      </Button>
    </div>
  </div>
);

const ConfirmRejectRequestContent: React.FC<{
  record: FileObject;
  onConfirm: (reason: RejectionReasons) => void;
}> = ({ record, onConfirm }) => {
  const [reason, setReason] = useState<RejectionReasons | ''>('');

  return (
    <div>
      <AlertDialog.Title className="text-lg font-bold flex items-center gap-2 mb-3">
        <UserX className="w-5 h-5 text-red-500" />
        Decline Subject Request
      </AlertDialog.Title>

      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        You are declining a request to be marked as the subject of this record.
      </AlertDialog.Description>

      {/* Record Info */}
      <div className="p-3 border rounded-lg bg-gray-50 mb-4">
        <p className="text-xs text-gray-500 mb-1">Record</p>
        <p className="font-medium text-gray-900">
          {record.belroseFields?.title || record.fileName || 'Untitled Record'}
        </p>
      </div>

      {/* Reason Dropdown */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Reason for declining <span className="text-red-500">*</span>
        </label>
        <select
          value={reason}
          onChange={e => setReason(e.target.value as RejectionReasons | '')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
        >
          <option value="">Select a reason...</option>
          {REJECTION_REASON_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-600 leading-relaxed">
          The person who sent this request will be notified that you declined. No network
          transaction is required.
        </p>
      </div>

      <div className="flex gap-3">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <Button
          onClick={() => reason && onConfirm(reason)}
          className="flex-1 bg-red-600 hover:bg-red-700"
        >
          Decline Request
        </Button>
      </div>
    </div>
  );
};

const ConfirmRemoveSubjectStatusContent: React.FC<{
  record: FileObject;
  revokeAccess: boolean;
  setRevokeAccess: (value: boolean) => void;
  onConfirm: (reason: RejectionReasons) => void;
}> = ({ record, revokeAccess, setRevokeAccess, onConfirm }) => {
  const [reason, setReason] = useState<RejectionReasons | ''>('');

  return (
    <div>
      <AlertDialog.Title className="text-lg font-bold flex items-center gap-2 mb-3">
        <UserMinus className="w-5 h-5 text-orange-500" />
        Remove Subject Status
      </AlertDialog.Title>

      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        You are removing yourself as a subject of this record.
      </AlertDialog.Description>

      {/* Record Info */}
      <div className="p-3 border rounded-lg bg-gray-50 mb-4">
        <p className="text-xs text-gray-500 mb-1">Record</p>
        <p className="font-medium text-gray-900">
          {record.belroseFields?.title || record.fileName || 'Untitled Record'}
        </p>
      </div>

      {/* Warning Card */}
      <div className="p-4 border rounded-lg bg-orange-50 border-orange-200 mb-4">
        <div className="flex gap-3">
          <Unlink className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-orange-900">What happens next</p>
            <ul className="mt-2 text-sm text-orange-800 space-y-1">
              <li>• Your link to this record will be removed</li>
              <li>• This will be recorded on the distributed network</li>
              <li>• The record creator will be notified</li>
              {revokeAccess && <li>• Your access to this record will be revoked</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* Reason Dropdown */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Reason for removing <span className="text-red-500">*</span>
        </label>
        <select
          value={reason}
          onChange={e => setReason(e.target.value as RejectionReasons | '')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
        >
          <option value="">Select a reason...</option>
          {REJECTION_REASON_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Revoke Access Checkbox */}
      <div className="mb-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={revokeAccess}
            onChange={e => setRevokeAccess(e.target.checked)}
            className="mt-0.5 w-4 h-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-900">
              Also revoke my access to this record
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Uncheck this if you still need access to this record after removing your subject
              status (unusual).
            </p>
          </div>
        </label>
      </div>

      {/* Additional Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
        <p className="text-xs text-amber-800 leading-relaxed">
          <strong>Note:</strong> If you previously accepted a consent request, the record creator
          may choose to publicly note that you withdrew your consent.
        </p>
      </div>

      <div className="flex gap-3">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <Button
          onClick={() => reason && onConfirm(reason)}
          className="flex-1 bg-red-600 hover:bg-orange-700"
        >
          Remove Status
        </Button>
      </div>
    </div>
  );
};

export default SubjectActionDialog;

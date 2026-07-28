import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { X, Save, Ellipsis, Info } from 'lucide-react';
import { FileObject } from '@/types/core';
import { LayoutSlot } from '@/components/app/LayoutProvider';
import VersionControlPanel from './Edit/VersionControlPanel';
import { RecordVersion } from '../services/versionControlService.types';
import { CredibilityView } from '@/features/Credibility/components/CredibilityView';
import HealthRecordMenu from './View/RecordMenu';
import { CredibilityBadge } from '@/features/Credibility/components/ui/CredibilityBadge';
import RecordView from './View/RecordView';
import { TabType } from './View/RecordView';
import { EncryptionAccessView } from '@/features/Sharing/components/EncryptionAccessView';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import PermissionsManager from '@/features/Permissions/components/PermissionManager';
import SubjectManager from '@/features/Subject/components/SubjectManager';
import SubjectBadge from '@/features/Subject/components/SubjectBadge';
import { useSubjectFlow } from '@/features/Subject/hooks/useSubjectFlow';
import { SubjectActionDialog } from '@/features/Subject/components/ui/SubjectActionDialog';
import {
  PendingSubjectRequestAlert,
  RejectionResponseAlert,
  RemovalRequestAlert,
  VerifiedNoSubjectAlert,
} from '@/features/Subject/components/SubjectAlertBanners';
import { useSubjectAlerts } from '@/features/Subject/hooks/useSubjectAlerts';
import SubjectService from '@/features/Subject/services/subjectService';
import SubjectRemovalService from '@/features/Subject/services/subjectRemovalService';
import { useNavigate } from 'react-router-dom';
import { useReviewedByCurrentUser } from '@/features/Credibility/hooks/useReviewedByCurrentUser';
import FollowUpBadge from '@/features/RecordFollowUp/components/ui/FollowUpBadge';
import RecordFollowUpsView from '@/features/RecordFollowUp/components/RecordFollowUpsView';
import { BelroseFields } from '@belrose/shared';
import LinkRequestModal from '@/features/RequestRecord/components/Respond/LinkRequestModal';
import { useRecordFollowUps } from '@/features/RecordFollowUp/hooks/useRecordFollowUps';
import { CopyableHash } from '@/features/BackendChainParity/components/ui/CopyableHash';
import { useAuthContext } from '@/features/Auth/AuthContext';
import { GuestFeatureGate } from '@/features/GuestAccess/components/GuestFeatureGate';
import SubjectPermissionService from '@/features/Subject/services/subjectPermissionService';
import { toast } from 'sonner';
import { PermissionsService } from '@/features/Permissions/services/permissionsService';

type ViewMode =
  | 'record'
  | 'edit'
  | 'versions'
  | 'version-detail'
  | 'credibility'
  | 'access'
  | 'permissions'
  | 'subject'
  | 'follow-up';

export type UrlViewMode = Exclude<ViewMode, 'version-detail'>; //Initial view mode is never version-detail

// Used in RecordDetail.tsx page for urls. Excludes version-detail because you can't navigate directly there
export const VALID_VIEWS: UrlViewMode[] = [
  'record',
  'edit',
  'versions',
  'credibility',
  'access',
  'permissions',
  'subject',
  'follow-up',
];

interface RecordFullProps {
  record: FileObject;
  className?: string;
  showMenu?: boolean;

  //File Management Props --> done by useRecordActions hook
  onSave: (updatedRecord: FileObject) => void;
  onDownload: (record: FileObject) => void;
  onCopy: (record: FileObject) => void;
  onDelete: (record: FileObject) => void;
  onRefreshRecord?: () => void;

  // Navigation Props
  onBack: (record: FileObject) => void;
  initialViewMode?: UrlViewMode; // Seeded from ?view= in the URL by RecordDetail. Defaults to 'record'.
  readOnly?: boolean;
  onViewModeChange?: (view: string) => void;
}

export const RecordFull: React.FC<RecordFullProps> = ({
  record,
  onSave,
  onDownload,
  onCopy,
  onDelete,
  onRefreshRecord,
  onBack,
  initialViewMode = 'record',
  readOnly = false,
  onViewModeChange,
}) => {
  const { user } = useAuthContext();

  // Subject Alerts hook
  const subjectAlerts = useSubjectAlerts({ recordId: record.id });

  // Subject flow hook for accept/decline actions
  const subjectFlow = useSubjectFlow({
    record,
    onSuccess: () => {
      // Clear the pending request banner after successful action
      subjectAlerts.refetch();
      handleRefreshRecord();
    },
    onRejectSuccess: () => {
      navigate('/app/all-records'); // After rejecting a subject request, navigate away from the record
    },
  });

  // =========================================================================
  // VIEW STATE
  //
  // urlViewMode: the "real" panel — synced to the URL via onViewModeChange.
  // isVersionDetail: local-only overlay for viewing a decrypted historical
  //   version. Kept out of the URL because the decrypted snapshot is
  //   ephemeral in-memory data — the URL would be meaningless if shared.
  //
  // The computed `viewMode` combines both: if isVersionDetail is true it wins,
  // otherwise urlViewMode is used. setViewMode handles the split automatically.
  // =========================================================================

  const [isVersionDetail, setIsVersionDetail] = useState(false);
  const viewMode: ViewMode = isVersionDetail ? 'version-detail' : initialViewMode;

  const setViewMode = (mode: ViewMode) => {
    if (mode === 'version-detail') {
      // version-detail is local only — don't touch the URL
      setIsVersionDetail(true);
      return;
    }
    setIsVersionDetail(false);
    onViewModeChange?.(mode); // sync URL in parent
  };

  // Only owners/administrators can edit — viewers/sharers can reach ?view=edit directly via
  // URL even though the menu hides "Edit" for them, so this is enforced here too, not just at
  // the button level.
  const canEditRecord = user ? PermissionsService.canManageRecord(record, user.uid) : false;

  useEffect(() => {
    if (viewMode === 'edit' && !canEditRecord) {
      toast.error("You don't have permission to edit this record");
      setViewMode('record');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, canEditRecord]);

  const [activeTab, setActiveTab] = useState<TabType>('record');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasFhirChanges, setHasFhirChanges] = useState(false);
  const [currentFhirData, setCurrentFhirData] = useState(record.fhirData);
  const [editedBelroseFields, setEditedBelroseFields] = useState<BelroseFields | undefined>(
    record.belroseFields
  );
  const [viewingVersion, setViewingVersion] = useState<RecordVersion | null>(null);
  const [decryptedVersionData, setDecryptedVersionData] = useState<any>(null);
  const [enterVerificationInModifyMode, setEnterVerificationinModifyMode] = useState(false);
  const [enterDisputeInModifyMode, setEnterDisputeinModifyMode] = useState(false);
  const { hasReviewed, isLoading: isCheckingReview } = useReviewedByCurrentUser(record);
  const [linkRequestOpen, setLinkRequestOpen] = useState(false);
  const navigate = useNavigate();

  // For managing subject banner
  const hasSubject = (record.subjects || []).length > 0;
  const showVerifiedNoSubjectBanner =
    !isCheckingReview &&
    hasReviewed &&
    !hasSubject &&
    !subjectAlerts.hasSubjectRequest && // don't double-stack with the pending invite banner
    viewMode !== 'version-detail'; // don't double stack with version detail

  // =========================================================================
  // VERSION DECRYPTION
  // =========================================================================

  const decryptVersionSnapshot = async (version: RecordVersion): Promise<any> => {
    // Check if encryption session is active
    const masterKey = await EncryptionKeyManager.getSessionKey();
    if (!masterKey) {
      throw new Error('Please unlock your encryption to view this version.');
    }

    // Decrypt the version
    const encryptedRecord: FileObject = {
      ...record,
      encryptedFileName: version.recordSnapshot.encryptedFileName,
      encryptedExtractedText: version.recordSnapshot.encryptedExtractedText,
      encryptedOriginalText: version.recordSnapshot.encryptedOriginalText,
      encryptedContextText: version.recordSnapshot.encryptedContextText,
      encryptedFhirData: version.recordSnapshot.encryptedFhirData,
      encryptedBelroseFields: version.recordSnapshot.encryptedBelroseFields,
      isEncrypted: true,
    };

    const decryptedData = await RecordDecryptionService.decryptRecord(encryptedRecord);

    return {
      fileName: decryptedData.fileName ?? null,
      fhirData: decryptedData.fhirData ?? null,
      belroseFields: decryptedData.belroseFields ?? null,
      extractedText: decryptedData.extractedText ?? null,
      originalText: decryptedData.originalText ?? null,
    };
  };

  const reconstructFileObjectFromVersion = (
    versionData: any,
    version: RecordVersion,
    originalRecord: FileObject
  ): FileObject => {
    return {
      ...originalRecord,

      //Restored Data from Snapshot
      fhirData: versionData.fhirData,
      belroseFields: versionData.belroseFields,
      extractedText: versionData.extractedText,
      originalText: versionData.originalText,

      // Get Hashes from Version Metadata
      recordHash: version.recordHash ?? null,
      previousRecordHash: originalRecord.recordHash
        ? [...(originalRecord.previousRecordHash ?? []), originalRecord.recordHash]
        : (originalRecord.previousRecordHash ?? null),
      originalFileHash: originalRecord.originalFileHash ?? null,
    };
  };

  const displayRecord =
    viewMode === 'version-detail' && viewingVersion && decryptedVersionData
      ? reconstructFileObjectFromVersion(decryptedVersionData, viewingVersion, record)
      : record;

  // =========================================================================
  // VIEW MODE HANDLERS
  // =========================================================================

  const handleModifyVerificationFromVersions = () => {
    setEnterVerificationinModifyMode(true);
    setViewMode('credibility');
  };

  const handleModifyDisputeFromVersions = () => {
    setEnterDisputeinModifyMode(true);
    setViewMode('credibility');
  };

  const handleEnterEditMode = () => {
    if (readOnly || !canEditRecord) return;
    setViewMode('edit');
    setActiveTab('record');
    setEditedBelroseFields(record.belroseFields || undefined);
  };

  const handleViewVersionHistory = () => {
    setViewMode('versions');
  };

  const handleViewCredibility = () => {
    setEnterVerificationinModifyMode(false);
    setViewMode('credibility');
  };

  const handleAccessPage = () => {
    setViewMode('access');
  };

  const handlePermissionManager = () => {
    setViewMode('permissions');
  };

  const handleSubjectPage = () => {
    setViewMode('subject');
  };

  const handleFollowUpsPage = () => {
    setViewMode('follow-up');
  };

  const handleViewVersion = async (version: RecordVersion) => {
    try {
      // Decrypt the version data
      const decryptedData = await decryptVersionSnapshot(version);

      // Store both the version and its decrypted data
      setViewingVersion(version);
      setDecryptedVersionData(decryptedData);
      setViewMode('version-detail');
    } catch (error: any) {
      console.error('Failed to view version:', error);
      alert(error.message || 'Failed to view version. Please try again.');
    }
  };

  const handleBackToRecord = () => {
    setViewMode('record');
    setViewingVersion(null);
    setDecryptedVersionData(null); //Clear decrypted data
  };

  // =========================================================================
  // DATA HANDLERS
  // =========================================================================

  const handleFhirDataChange = (updatedData: any) => setCurrentFhirData(updatedData);
  const handleFhirChanged = (hasChanges: boolean) => setHasFhirChanges(hasChanges);
  const {
    followUpItems,
    isLoading: followUpsLoading,
    refetch: refetchFollowUps,
  } = useRecordFollowUps(record);

  // For record actions that may affect the follows up badge, also refetch followUps
  const handleRefreshRecord = () => {
    onRefreshRecord?.();
    refetchFollowUps();
  };

  const handleBelroseFieldsChange = (updatedFields: BelroseFields) => {
    setEditedBelroseFields(updatedFields);
    setHasUnsavedChanges(true);
  };

  // =========================================================================
  // SAVE / CANCEL HANDLERS
  // =========================================================================

  const hasAnyChanges = hasUnsavedChanges || hasFhirChanges;

  const handleSaveRecord = () => {
    const updatedRecord = {
      ...record,
      fhirData: currentFhirData,
      belroseFields: editedBelroseFields,
    };

    if (onSave) {
      onSave(updatedRecord);
    }

    setViewMode('record');
    setHasUnsavedChanges(false);
    setHasFhirChanges(false);
    console.log('✅ Record saved:', updatedRecord);
  };

  const handleCancelEdit = () => {
    setViewMode('record');
    setHasUnsavedChanges(false);
    setHasFhirChanges(false);
    setCurrentFhirData(record.fhirData);
    setEditedBelroseFields(record.belroseFields || undefined);
  };

  const handleExit = () => {
    if (hasAnyChanges) {
      const confirmExit = window.confirm(
        'You have unsaved changes. Are you sure you want to exit?'
      );
      if (!confirmExit) return;
    }
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/app/all-records'); // fallback if no history
    }
  };

  const handleVersionControlRollback = () => {
    setHasUnsavedChanges(false);
    setHasFhirChanges(false);
    setViewMode('record');
    onRefreshRecord?.();
  };

  // =========================================================================
  // SUBJECT HANDLERS
  // =========================================================================

  const handleDropRejection = async (subjectId: string) => {
    try {
      await SubjectService.respondToSubjectRejection(record.id, subjectId, 'dropped');
      subjectAlerts.refetch();
      handleRefreshRecord();
    } catch (error) {
      console.error('Error dropping rejection:', error);
    }
  };

  const handleEscalateRejection = async (subjectId: string) => {
    try {
      await SubjectService.respondToSubjectRejection(record.id, subjectId, 'escalated');
      subjectAlerts.refetch();
      handleRefreshRecord();
    } catch (error) {
      console.error('Error escalating rejection:', error);
    }
  };

  const handleRemoveSelf = () => {
    subjectFlow.initiateRemoveSubjectStatus();
  };

  const handleDisputeRemoval = async () => {
    try {
      await SubjectRemovalService.rejectRemoval(record.id);
      subjectAlerts.refetch();
      handleRefreshRecord();
    } catch (error) {
      console.error('Error escalating rejection:', error);
    }
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="max-w-7xl mx-auto bg-background rounded-2xl shadow-xl rounded-lg">
      {/* ===== HEADER SECTION ===== */}
      <div className="bg-primary rounded-lg">
        {/* Pending Subject Request Banner */}
        {/* Subject-related Alert Banners */}
        {!subjectAlerts.isLoading && viewMode !== 'version-detail' && (
          <LayoutSlot slot="header">
            <div className="space-y-2">
              {/* Pending subject request - someone invited you to be a subject */}
              {subjectAlerts.hasSubjectRequest && (
                <PendingSubjectRequestAlert
                  onAccept={() => subjectFlow.initiateAcceptRequest()}
                  onDecline={() => subjectFlow.initiateRejectRequest()}
                  isLoading={subjectFlow.isLoading}
                />
              )}

              {/* Rejection responses needed - subjects who removed themselves */}
              {subjectAlerts.pendingRejectionResponses.map(rejection => (
                <RejectionResponseAlert
                  key={rejection.subjectId}
                  subjectName={rejection.subjectName}
                  onDrop={() => handleDropRejection(rejection.subjectId)}
                  onEscalate={() => handleEscalateRejection(rejection.subjectId)}
                  isLoading={subjectFlow.isLoading}
                />
              ))}

              {/* Removal request - owner asked you to remove yourself */}
              {subjectAlerts.hasRemovalRequest && subjectAlerts.removalRequest && (
                <RemovalRequestAlert
                  onRemove={handleRemoveSelf}
                  onDispute={handleDisputeRemoval}
                  isLoading={subjectFlow.isLoading}
                />
              )}

              {showVerifiedNoSubjectBanner && (
                <VerifiedNoSubjectAlert
                  onSetSubject={handleSubjectPage}
                  isLoading={isCheckingReview}
                />
              )}
            </div>
          </LayoutSlot>
        )}

        {/* Version View Banner - for Viewing Old Versions */}
        {viewMode === 'version-detail' && viewingVersion && (
          <LayoutSlot slot="header">
            <div className="p-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="ml-3 flex items-center gap-2 text-yellow-100">
                  <span className="text-sm font-medium text-primary">
                    Viewing historical version #{viewingVersion.versionNumber} from{' '}
                    {formatTimestamp(viewingVersion.editedAt, 'long')}
                  </span>
                  {viewingVersion.commitMessage && (
                    <span className="text-xs opacity-75">• {viewingVersion.commitMessage}</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBackToRecord}
                  className="text-primary border-yellow-500/30 hover:bg-yellow-500/20"
                >
                  Return to Current
                </Button>
              </div>
            </div>
          </LayoutSlot>
        )}

        {/* Main Header */}
        <div className="bg-primary px-4 md:px-8 py-6 rounded-t-lg">
          {/* Top Row - Badges and Actions */}
          <div className="flex items-center justify-between gap-2 mb-3">
            {/*Left: type badges - scrollable on mobile */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide min-w-0">
              {viewMode !== 'edit' && (
                <>
                  <span className="flex-shrink-0 px-2 py-1 text-xs font-medium rounded-full border bg-background text-primary">
                    {displayRecord.belroseFields?.visitType}
                  </span>
                  <span className="flex-shrink-0 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded border">
                    {displayRecord.sourceType}
                  </span>
                </>
              )}
              {viewMode === 'edit' && (
                <span className="flex-shrink-0 px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-100 rounded border border-yellow-500/30">
                  Editing Mode
                </span>
              )}
            </div>

            {/**Right: credibility + divider + subject (md+) + menu + close */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <FollowUpBadge
                followUpItems={followUpItems}
                isLoading={followUpsLoading}
                onClick={handleFollowUpsPage}
              />
              <div className="hidden md:flex items-center">
                <SubjectBadge record={record} onClick={handleSubjectPage} />
              </div>
              <CredibilityBadge score={record.credibility?.score} />
              {!readOnly && (
                <HealthRecordMenu
                  record={record}
                  triggerIcon={Ellipsis}
                  triggerClassName="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                  onView={viewMode !== 'record' ? handleBackToRecord : undefined}
                  showEdit={canEditRecord}
                  onEdit={viewMode !== 'edit' ? handleEnterEditMode : undefined}
                  onVersion={viewMode !== 'versions' ? handleViewVersionHistory : undefined}
                  onSubject={viewMode !== 'subject' ? handleSubjectPage : undefined}
                  onAccess={viewMode !== 'access' ? handleAccessPage : undefined}
                  onCredibility={viewMode !== 'credibility' ? handleViewCredibility : undefined}
                  onPermissions={viewMode !== 'permissions' ? handlePermissionManager : undefined}
                  onFollowUp={viewMode !== 'follow-up' ? handleFollowUpsPage : undefined}
                  onDownload={onDownload}
                  onCopy={onCopy}
                  onDelete={onDelete}
                />
              )}
              <Button
                variant="default"
                className="p-2 w-8 h-8 hover:bg-white/20 transition-colors"
                onClick={handleExit}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Header Content */}
          {viewMode === 'edit' ? (
            // Edit Mode Banner
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-yellow-300 flex-shrink-0 mt-0.5" />
                <div className="text-center flex-1">
                  <h3 className="text-yellow-100 font-medium mb-1">Editing Record</h3>
                  <p className="text-yellow-200/80 text-sm">
                    Scroll down to edit your records, FHIR data, and other fields. Hash fields will
                    recalculate when you refresh the page.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            // View Mode - Normal Header
            <>
              <h1 className="text-xl md:text-2xl font-bold text-white mb-2 text-left">
                {displayRecord.belroseFields?.title}
              </h1>

              {/* Metadata — stacked on mobile, inline on md+ */}
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-white/80 mb-2">
                <span>{displayRecord.belroseFields?.completedDate}</span>
                {/* SubjectBadge inline with metadata on mobile only */}

                <span className="text-white/30">•</span>
                <span>{displayRecord.belroseFields?.patient}</span>
                <span className="text-white/30">•</span>
                <span>{displayRecord.belroseFields?.provider}</span>
                <span className="text-white/30">•</span>
                <span>{displayRecord.belroseFields?.institution}</span>
                <div className="flex items-center gap-1 md:hidden">
                  <SubjectBadge record={record} onOpenManager={handleSubjectPage} />
                </div>
              </div>

              <div className="flex justify-left text-white/50 text-left">
                <p>{displayRecord.belroseFields?.summary}</p>
              </div>
            </>
          )}

          {/* Record identifiers */}

          <div className="flex flex-wrap justify-between items-center text-xs font-mono text-white/50 mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center gap-1">
              <span>Record ID</span>
              <CopyableHash value={record.id} chars={10} className="text-white" />
              <span className="text-white/25">&middot;</span>
              <span>Network ID</span>
              <CopyableHash value={record.recordIdHash} chars={10} className="text-white" />
            </div>
            <div className="flex items-center gap-1">
              <span>Record Hash</span>
              <CopyableHash value={record.recordHash} chars={10} className="text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* ===== MAIN CONTENT AREA ===== */}
      {viewMode === 'versions' && (
        <VersionControlPanel
          documentId={record.id}
          onBack={handleBackToRecord}
          onRollback={handleVersionControlRollback}
          onViewVersion={handleViewVersion}
          record={record}
          onModifyVerification={handleModifyVerificationFromVersions}
          onModifyDispute={handleModifyDisputeFromVersions}
        />
      )}

      {(viewMode === 'record' || viewMode === 'edit' || viewMode === 'version-detail') && (
        <RecordView
          record={displayRecord}
          editable={viewMode === 'edit'}
          onFhirChanged={handleFhirChanged}
          onFhirDataChange={handleFhirDataChange}
          onBelroseFieldsChange={handleBelroseFieldsChange}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      )}

      {viewMode === 'permissions' && (
        <GuestFeatureGate featureName="manage sharing permissions">
          <PermissionsManager
            record={displayRecord}
            onBack={handleBackToRecord}
            onPermissionChange={onRefreshRecord}
          />
        </GuestFeatureGate>
      )}

      {viewMode === 'subject' && (
        <GuestFeatureGate featureName="manage record subjects">
          <SubjectManager
            record={displayRecord}
            onSuccess={handleRefreshRecord}
            onBack={handleBackToRecord}
          />
        </GuestFeatureGate>
      )}

      {/* ===== FOOTER SECTIONS ===== */}
      {viewMode === 'edit' && (
        <LayoutSlot slot="footer">
          <div className="flex justify-between items-center p-4 bg-white border-t border-gray-200">
            <div className="flex items-center gap-2">
              {hasAnyChanges && (
                <span className="px-3 py-1 text-sm bg-amber-100 text-amber-800 rounded-full font-medium">
                  Unsaved changes
                </span>
              )}
              <span className="text-sm text-gray-500">Editing health record data</span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={handleCancelEdit}>
                <X className="w-4 h-4" />
                Cancel
              </Button>

              <Button onClick={handleSaveRecord} disabled={!hasAnyChanges}>
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </div>
          </div>
        </LayoutSlot>
      )}

      {viewMode === 'version-detail' && (
        <LayoutSlot slot="footer">
          <div className="flex justify-end items-center p-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleViewVersionHistory}>
                <X className="w-4 h-4" />
                Return to Version History
              </Button>
              <Button onClick={handleVersionControlRollback}>
                <Save className="w-4 h-4" />
                Rollback
              </Button>
            </div>
          </div>
        </LayoutSlot>
      )}

      {viewMode === 'access' && (
        <EncryptionAccessView
          record={record}
          onBack={handleBackToRecord}
          onSuccess={onRefreshRecord}
        />
      )}

      {viewMode === 'credibility' && (
        <CredibilityView
          record={record}
          onBack={handleBackToRecord}
          onSuccess={refetchFollowUps}
          startModVerifyFromVersions={enterVerificationInModifyMode}
          startModDisputeFromVersions={enterDisputeInModifyMode}
        />
      )}

      {viewMode === 'follow-up' && (
        <RecordFollowUpsView
          record={record}
          onBack={() => {
            handleBackToRecord();
            handleRefreshRecord();
          }}
          onAction={(_, itemId) => {
            if (itemId === 'subject' || itemId === 'subject-rejection') setViewMode('subject');
            else if (itemId === 'verify') setViewMode('credibility');
            else if (itemId === 'link-request') setLinkRequestOpen(true);
          }}
        />
      )}

      {/* Subject Action Dialog for accept/decline flows */}
      <SubjectActionDialog {...subjectFlow.dialogProps} />

      {/* Link Request Modal — opened from follow-up actions */}
      <LinkRequestModal
        record={record}
        isOpen={linkRequestOpen}
        onClose={() => setLinkRequestOpen(false)}
        onSuccess={() => {
          setLinkRequestOpen(false);
          handleRefreshRecord();
        }}
        isGuest={user?.isGuest}
      />
    </div>
  );
};

export default RecordFull;

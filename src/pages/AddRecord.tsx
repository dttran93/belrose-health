import React, { useState } from 'react';
import useFileManager from '@/features/AddRecord/hooks/useFileManager';
import { convertToFHIR } from '@/features/AddRecord/services/fhirConversionService';
import { FileObject } from '@/types/core';
import CombinedUploadFHIR from '@/features/AddRecord/components/CombinedUploadFHIR';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '@/features/Auth/AuthContext';
import { GuestUploadBlockerModal } from '@/features/GuestAccess/components/GuestUploadBlockerModal';
import { GuestClaimAccountModal } from '@/features/GuestAccess/components/GuestClaimAccountModal';
import { useGuestUploadBlocker } from '@/features/GuestAccess/hooks/useGuestUploadBlocker';
import LinkRequestModal from '@/features/RequestRecord/components/Respond/LinkRequestModal';

interface AddRecordProps {
  className?: string;
}

// ==================== COMPONENT ====================

/**
 * Main page component for uploading and managing health records.
 * Handles both file uploads and direct FHIR input
 */
const AddRecord: React.FC<AddRecordProps> = ({ className }) => {
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const isGuest = user?.isGuest === true;

  const {
    files,
    savingToFirestore,
    addFiles,
    removeFileFromLocal,
    removeFileComplete,
    retryFile,
    updateFileStatus,
    uploadFiles,
    getStats,
    savedToFirestoreCount,
    savingCount,
    processVirtualRecord,
    processFile,
    reset: resetFileUpload,
  } = useFileManager();

  const [linkRequestFile, setLinkRequestFile] = useState<FileObject | null>(null);

  const completedFileIds = files
    .filter(f => f.status === 'completed' && f.firestoreId)
    .map(f => f.firestoreId!);

  const {
    blocker,
    pendingRequest,
    refreshRequests,
    showClaimModal,
    openClaimModal,
    closeClaimModal,
  } = useGuestUploadBlocker({ isGuest, candidateRecordIds: completedFileIds });

  const handleReviewFile = (fileRecord: FileObject, viewMode: string = 'record') => {
    if (!fileRecord.id) {
      console.error('File not found:', fileRecord.firestoreId);
      return;
    }

    // Navigate to AllRecords with the record to open in correct mode
    navigate(`/app/records/${fileRecord.id}?view=${viewMode}`);
  };

  // When the blocker fires, auto-select the first completed file
  const handleFulfillAndExit = () => {
    if (blocker.state !== 'blocked') return; // ← narrows the type
    const fileObj = files.find(f => f.status === 'completed' && f.firestoreId) as FileObject;
    if (!fileObj) return;
    blocker.reset();
    setLinkRequestFile(fileObj);
  };

  // ==================== RENDER JSX ====================

  return (
    <div className={`min-h-screen bg-gray-50 ${className || ''}`}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Main Upload Interface */}
        <CombinedUploadFHIR
          files={files}
          addFiles={addFiles}
          removeFile={removeFileComplete}
          removeFileFromLocal={removeFileFromLocal}
          retryFile={retryFile}
          getStats={getStats}
          addFhirAsVirtualFile={processVirtualRecord}
          uploadFiles={uploadFiles}
          convertTextToFHIR={convertToFHIR}
          savingToFirestore={savingToFirestore}
          onReview={handleReviewFile}
          processFile={processFile}
          isGuest={isGuest}
        />
      </div>

      {/* Blocks navigation until guest resolves their upload — lets them through to review any
          of their own still-unsecured records (see useGuestUploadBlocker) */}
      {blocker.state === 'blocked' && (
        <GuestUploadBlockerModal
          pendingRequest={pendingRequest}
          completedFiles={files.filter(f => f.status === 'completed') as FileObject[]}
          onClaim={openClaimModal}
          onFulfillAndExit={handleFulfillAndExit}
          onLeave={() => blocker.proceed()}
        />
      )}

      {showClaimModal && (
        <GuestClaimAccountModal
          isOpen={showClaimModal}
          onClose={closeClaimModal}
          onComplete={() => navigate('/app/record-requests')}
          guestContext="record_request"
        />
      )}

      {linkRequestFile && (
        <LinkRequestModal
          record={linkRequestFile}
          isOpen={true}
          onClose={() => {
            setLinkRequestFile(null);
            refreshRequests();
          }}
          onSuccess={() => {
            setLinkRequestFile(null);
            refreshRequests();
          }}
          isGuest={isGuest}
        />
      )}
    </div>
  );
};

export default AddRecord;

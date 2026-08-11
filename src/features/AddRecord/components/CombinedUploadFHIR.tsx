import React, { useState, useCallback, useRef } from 'react';
import { FileText, Upload, Code, MessageSquare, CheckCircle, ExternalLink } from 'lucide-react';
import { FileListItem } from './FileListItem';
import { TabNavigation } from '../../../components/ui/TabNavigation';
import { FileObject } from '@/types/core';
import UploadTab from './ui/UploadTab';
import TextTab from './ui/TextTab';
import FHIRTab from './ui/FHIRTab';
import type { CombinedUploadFHIRProps } from './CombinedUploadFHIR.type';
import LinkRequestModal from '@/features/RequestRecord/components/Respond/LinkRequestModal';
import SubjectActionDialog from '@/features/Subject/components/ui/SubjectActionDialog';
import { useSubjectFlow } from '@/features/Subject/hooks/useSubjectFlow';

export type TabType = 'upload' | 'text' | 'fhir';

const TABS = [
  { id: 'upload', label: 'File Upload', icon: Upload },
  { id: 'text', label: 'Text Input', icon: MessageSquare },
  { id: 'fhir', label: 'FHIR Data', icon: Code },
];

const CombinedUploadFHIR: React.FC<CombinedUploadFHIRProps> = ({
  files,
  addFiles,
  removeFile,
  removeFileFromLocal,
  retryFile,
  getStats,
  onReview,
  processFile,
  uploadFiles,
  addFhirAsVirtualFile,
  convertTextToFHIR,
  acceptedTypes = ['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png'],
  maxFiles = 5,
  maxSizeBytes = 10 * 1024 * 1024,
  className = '',
  isGuest,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('upload');
  const [linkRequestRecord, setLinkRequestRecord] = useState<FileObject | null>(null);
  const lastLinkRequestRecord = useRef<FileObject | null>(null);
  const [subjectRecord, setSubjectRecord] = useState<FileObject | null>(null);
  const lastSubjectRecord = useRef<FileObject | null>(null);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);

  const stats = getStats();
  const hasProcessingFiles = files.length > 0;
  const pendingFiles = files.filter(f => f.status === 'pending');
  const hasAttachedFiles = pendingFiles.length > 0;
  const allFilesCompleted =
    hasProcessingFiles && stats.completed === stats.total && stats.errors === 0;
  const hasErrors = stats.errors > 0;

  const subjectFlow = useSubjectFlow({
    record: lastSubjectRecord.current ?? ({} as FileObject),
    onSuccess: () => {
      setSubjectRecord(null);
      setFollowUpRefreshKey(k => k + 1);
    },
  });

  const handleFollowUpAction = (fileItem: FileObject, itemId: string) => {
    if (itemId === 'link-request') {
      lastLinkRequestRecord.current = fileItem;
      setLinkRequestRecord(fileItem);
      return;
    }
    if (itemId === 'subject' || itemId === 'subject-rejection') {
      lastSubjectRecord.current = fileItem;
      setSubjectRecord(fileItem);
      subjectFlow.initiateAddSubject();
      return;
    }
    if (itemId === 'verify') {
      onReview(fileItem, 'credibility');
      return;
    }
    onReview(fileItem);
  };

  const handleCancelDeleteReset = (fileId: string) => {
    // Cancels/removes only the file that was clicked — not the whole batch. removeFile
    // (removeFileComplete) handles both stopping the upload and cleaning up local state itself.
    removeFile(fileId);
    setActiveTab('upload');
  };

  const handleConfirm = useCallback(
    (fileId: string) => removeFileFromLocal(fileId),
    [removeFileFromLocal]
  );

  const handleRetryFile = (fileItem: FileObject) => retryFile(fileItem.id);

  return (
    <>
      <div className={`space-y-6 ${className}`}>
        <div className="bg-white rounded-lg shadow-sm border">
          {/* Header */}
          <div className="p-4 border-b">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <span>Add Health Record</span>
            </h2>
            <p className="text-sm text-left text-gray-600 m-3">
              Add your health record in any format you like. Upload images, PDFs, word docs; type
              medical notes; or input a FHIR JSON directly - everything will be processed and
              uploaded automatically.
            </p>
          </div>

          {hasProcessingFiles && !hasAttachedFiles ? (
            /* FILE PROCESSING VIEW */
            <>
              <div className="p-4 border-b bg-blue-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {allFilesCompleted ? 'All Files Processed!' : 'Processing Files'}
                    </h3>
                  </div>
                  {!allFilesCompleted && (
                    <p className="text-xs text-destructive">
                      Feel free to navigate away — you can track upload progress in the activity
                      tray (bottom-right) ↘
                    </p>
                  )}
                  <div className="text-sm text-gray-600">
                    {stats.completed} of {stats.total} completed
                    {stats.processing > 0 && (
                      <span className="ml-2 text-blue-600 font-medium">
                        ({stats.processing} processing)
                      </span>
                    )}
                    {hasErrors && (
                      <span className="ml-2 text-red-600 font-medium">({stats.errors} errors)</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                {files.map((fileItem: FileObject) => (
                  <FileListItem
                    key={fileItem.id}
                    fileItem={fileItem}
                    fhirResult={
                      fileItem.fhirData
                        ? { success: true, fhirData: fileItem.fhirData, error: undefined }
                        : undefined
                    }
                    onConfirm={handleConfirm}
                    onRemove={handleCancelDeleteReset}
                    onRetry={handleRetryFile}
                    showFHIRResults={true}
                    onReview={onReview}
                    onAction={handleFollowUpAction}
                    refreshKey={followUpRefreshKey}
                  />
                ))}
              </div>
            </>
          ) : (
            /* INPUT INTERFACE */
            <>
              <div className="p-4 pb-0">
                <TabNavigation
                  tabs={TABS}
                  activeTab={activeTab}
                  onTabChange={id => setActiveTab(id as TabType)}
                />
              </div>

              <div className="p-6">
                {activeTab === 'upload' && (
                  <UploadTab
                    files={files}
                    addFiles={addFiles}
                    removeFileFromLocal={removeFileFromLocal}
                    processFile={processFile}
                    uploadFiles={uploadFiles}
                    acceptedTypes={acceptedTypes}
                    maxFiles={maxFiles}
                    maxSizeBytes={maxSizeBytes}
                  />
                )}
                {activeTab === 'text' && (
                  <TextTab
                    convertTextToFHIR={convertTextToFHIR}
                    addFhirAsVirtualFile={addFhirAsVirtualFile}
                  />
                )}
                {activeTab === 'fhir' && <FHIRTab addFhirAsVirtualFile={addFhirAsVirtualFile} />}
              </div>
            </>
          )}
        </div>
      </div>
      {/*Link Request Modal - called from within FileListItem follow-up action*/}
      {linkRequestRecord && (
        <LinkRequestModal
          record={linkRequestRecord}
          isOpen={true}
          onClose={() => setLinkRequestRecord(null)}
          onSuccess={() => setLinkRequestRecord(null)}
          isGuest={isGuest}
        />
      )}
      <SubjectActionDialog {...subjectFlow.dialogProps} />
    </>
  );
};

export default CombinedUploadFHIR;

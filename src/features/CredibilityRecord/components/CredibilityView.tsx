// src/features/CredibilityRecord/components/CredibilityView.tsx

/**
 * Shows all reviews for a recordId, including ones for different hashes
 * and reviews made by people other than the user vs. RecordReviewPanel
 * which only shows the current user's reviews
 *
 * Includes the Verification/Dispute Management components to allow the user to
 * view the details related to other reviews on the selected record
 */

import React, { useState, useEffect } from 'react';
import { FileObject } from '@/types/core';
import { RecordHashService } from '@/features/ViewEditRecord/services/generateRecordHash';
import { ArrowLeft, Shield, HeartHandshake } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { RecordReviewPanel } from './RecordReviewPanel';
import { useAuth } from '@/features/Auth/hooks/useAuth';
import VerificationManagement from './Verifications/VerificationManagement';
import { getVerificationsByRecordId } from '../services/verificationService';
import { getDisputesByRecordId } from '../services/disputeService';
import DisputeManagement from './Disputes/DisputeManagement';
import { useCredibilityFlow } from '../hooks/useCredibilityFlow';
import CredibilityActionDialog from './ui/CredibilityActionDialog';
import { VerificationDoc } from '@belrose/shared';

type ViewMode = 'loading' | 'empty' | 'list' | 'add';
type ReviewTab = 'verify' | 'dispute';

interface CredibilityViewProps {
  record: FileObject;
  onBack: () => void;
  onSuccess?: () => void;
  startModVerifyFromVersions?: boolean;
  startModDisputeFromVersions?: boolean;
}

export const CredibilityView: React.FC<CredibilityViewProps> = ({
  record,
  onBack,
  onSuccess,
  startModVerifyFromVersions = false,
  startModDisputeFromVersions = false,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('loading');
  const [reviewPanelInitialTab, setReviewPanelInitialTab] = useState<ReviewTab>('verify');
  const [initialModifyingDispute, setInitialModifyingDispute] = useState(false);
  const [initialModifyingVerification, setInitialModifyingVerification] = useState(false);
  const [verifications, setVerifications] = useState<VerificationDoc[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const { user } = useAuth();
  const [credibilityRefreshKey, setCredibilityRefreshKey] = useState(0);

  console.log('Current View', viewMode);

  // Generate and retrieve the record hash
  const recordHash = (record.recordHash || RecordHashService.generateRecordHash(record)) as string;
  const recordId = record.firestoreId || record.id;
  const recordTitle = record.belroseFields?.title || record.fileName || '';

  const handleOperationSuccess = async () => {
    try {
      // 1. Refresh the hook's internal state (user's specific verification/dispute)
      await refetch();

      // 2. Refresh the lists of verifications/disputes for this record
      const [fetchedVerifications, fetchedDisputes] = await Promise.all([
        getVerificationsByRecordId(recordId),
        // Assuming you have this service function:
        getDisputesByRecordId(recordId),
      ]);

      setVerifications(fetchedVerifications);
      setDisputes(fetchedDisputes);

      // 3. Navigation logic
      if (viewMode === 'add') {
        setViewMode('list');
      }

      // 4. refreshKey after successful Operation
      setCredibilityRefreshKey(k => k + 1);
      onSuccess?.();

      console.log('Credibility data synchronized.');
    } catch (error) {
      console.error('Error refreshing credibility data:', error);
    }
  };

  const {
    dialogProps,
    verification,
    isLoadingVerification,
    dispute,
    isLoadingDispute,
    initiateVerification,
    initiateRetractVerification,
    initiateModifyVerification,
    initiateDispute,
    initiateRetractDispute,
    initiateModifyDispute,
    isLoading,
    refetch,
  } = useCredibilityFlow({
    recordId,
    recordHash,
    recordTitle,
    onSuccess: handleOperationSuccess,
  });

  // Fetch verifications on mount and when record changes
  useEffect(() => {
    const fetchCredibilityData = async () => {
      if (!recordId) {
        setViewMode('empty');
        return;
      }

      try {
        const [fetchedVerifications, fetchedDisputes] = await Promise.all([
          getVerificationsByRecordId(recordId),
          getDisputesByRecordId(recordId),
        ]);

        setVerifications(fetchedVerifications);
        setDisputes(fetchedDisputes);

        // Determine initial view mode based on whether verifications exist
        if (fetchedVerifications.length > 0 || fetchedDisputes.length > 0) {
          setViewMode('list');
        } else {
          setViewMode('empty');
        }
      } catch (error) {
        console.error('Error fetching verifications:', error);
        setViewMode('empty');
      }
    };

    fetchCredibilityData();
  }, [recordId]);

  const handleBackClick = () => {
    if (viewMode === 'add') {
      // Go back to list or empty state
      setViewMode(verifications.length > 0 ? 'list' : 'empty');
    } else {
      onBack();
    }
  };

  useEffect(() => {
    if (startModVerifyFromVersions && verification) {
      setReviewPanelInitialTab('verify');
      setInitialModifyingVerification(true);
      setViewMode('add');
    }
  }, [startModVerifyFromVersions, verification, isLoadingVerification]);

  useEffect(() => {
    if (startModDisputeFromVersions && dispute) {
      setReviewPanelInitialTab('dispute');
      setInitialModifyingDispute(true);
      setViewMode('add');
    }
  }, [startModDisputeFromVersions, dispute, isLoadingDispute]);

  const handleAddVerification = () => {
    setReviewPanelInitialTab('verify');
    setViewMode('add');
  };

  const handleModifyVerification = () => {
    setReviewPanelInitialTab('verify');
    setInitialModifyingVerification(true);
    setViewMode('add');
  };

  const handleAddDispute = () => {
    setReviewPanelInitialTab('dispute');
    setInitialModifyingDispute(false);
    setViewMode('add');
  };

  const handleModifyDispute = () => {
    setReviewPanelInitialTab('dispute');
    setInitialModifyingDispute(true);
    setViewMode('add');
  };

  if (!user) {
    return <div>Please log in to view credibility information.</div>;
  }

  return (
    <div className="w-full mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <HeartHandshake className="w-5 h-5" />
          Credibility
        </h3>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleBackClick}
            className="w-8 h-8 border-none bg-transparent hover:bg-gray-200"
          >
            <ArrowLeft className="text-primary" />
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {viewMode === 'loading' && (
        <div className="flex justify-center items-center py-12">
          <p className="text-gray-500">Loading credibility data...</p>
        </div>
      )}

      {/* Empty State */}
      {viewMode === 'empty' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Shield className="w-10 h-10 text-gray-400" />
            </div>
            <h2 className="text-2xl font-medium text-gray-900 mb-4">
              No Verifications or Disputes
            </h2>
            <p className="text-gray-600 mb-8 max-w-md mx-auto">
              This record has no verifications or disputes and is fully self-reported. Click below
              to file this record's first credibility review:
            </p>
            <Button onClick={handleAddVerification}>Create Record Credibility Review</Button>
          </div>
        </div>
      )}

      {/* List State - Show VerificationManagement */}
      {viewMode === 'list' && (
        <>
          <VerificationManagement
            record={record}
            onBack={onBack}
            onAddMode={handleAddVerification}
            isAddMode={false}
            onModify={handleModifyVerification}
            onRetract={verification => initiateRetractVerification(verification.recordHash)}
            refreshKey={credibilityRefreshKey}
          />
          <DisputeManagement
            record={record}
            onBack={onBack}
            onAddMode={handleAddDispute}
            isAddMode={false}
            onRetract={dispute => initiateRetractDispute(dispute.recordHash)}
            onModify={handleModifyDispute}
            refreshKey={credibilityRefreshKey}
          />
        </>
      )}

      {/* Add State - Show RecordReviewPanel */}
      {viewMode === 'add' && (
        <RecordReviewPanel
          recordId={recordId}
          recordHash={recordHash}
          recordTitle={record.belroseFields?.title || record.fileName || 'Medical Record'}
          onViewRecord={handleBackClick}
          onSuccess={handleOperationSuccess}
          initialTab={reviewPanelInitialTab}
          existingDispute={dispute}
          initiateVerification={initiateVerification}
          initiateDispute={initiateDispute}
          initiateRetractVerification={initiateRetractVerification}
          initiateRetractDispute={initiateRetractDispute}
          initiateModifyVerification={initiateModifyVerification}
          initiateModifyDispute={initiateModifyDispute}
          verification={verification}
          isLoading={isLoading}
          initialModifyingDispute={initialModifyingDispute}
          initialModifyingVerification={initialModifyingVerification}
        />
      )}

      <CredibilityActionDialog {...dialogProps} />
    </div>
  );
};

export default CredibilityView;

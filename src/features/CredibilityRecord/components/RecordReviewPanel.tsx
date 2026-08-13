// src/features/CredibilityRecord/components/RecordReviewPanel.tsx

/**
 * Component for writing verifications or disputes for an individual recordHash
 * 2 separate tabs, one to create a new verification and another to create a dispute
 *
 * If a review already exists, it shows options to retract or modify the existing review
 */

import React, { useState } from 'react';
import { cn } from '@/utils/utils';
import { Button } from '@/components/ui/Button';
import { CheckCircle, AlertTriangle, ChevronRight, HelpCircle, Loader2 } from 'lucide-react';
import VerificationForm from './Verifications/VerificationForm';
import DisputeForm from './Disputes/DisputeForm';
import * as Tooltip from '@radix-ui/react-tooltip';
import { DisputeSeverity } from '../services/disputeService';

import { GuestFeatureGate } from '@/features/GuestAccess/components/GuestFeatureGate';
import { VerificationLevelOptions } from '../hooks/useCredibilityFlow';
import { DisputeCulpability, DisputeDoc, VerificationDoc } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

export interface RecordReviewPanelProps {
  recordId: string;
  recordHash: string;
  recordTitle?: string;
  onViewRecord?: () => void;
  onSuccess?: () => void;
  existingDispute?: DisputeDoc | null;
  initialTab?: 'verify' | 'dispute';
  initiateVerification: (level: VerificationLevelOptions) => void;
  initiateDispute: (sev: DisputeSeverity, culp: DisputeCulpability, notes?: string) => void;
  initiateRetractVerification: (recordHash?: string) => Promise<void>;
  initiateRetractDispute: (recordHash?: string) => Promise<void>;
  initiateModifyVerification: (
    recordHash: string,
    newLevel: VerificationLevelOptions
  ) => Promise<void>;
  initiateModifyDispute: (
    recordHash: string,
    newSeverity?: DisputeSeverity,
    newCulpability?: DisputeCulpability
  ) => Promise<void>;
  verification: VerificationDoc | null;
  isLoading: boolean;
  initialModifyingDispute: boolean;
  initialModifyingVerification: boolean;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export const RecordReviewPanel: React.FC<RecordReviewPanelProps> = ({
  recordId,
  recordHash,
  onViewRecord,
  onSuccess,
  existingDispute = null,
  initialTab = 'verify',
  initiateVerification,
  initiateDispute,
  initiateRetractVerification,
  initiateRetractDispute,
  initiateModifyVerification,
  initiateModifyDispute,
  verification,
  isLoading,
  initialModifyingDispute = false,
  initialModifyingVerification = false,
}) => {
  const [activeTab, setActiveTab] = useState<'verify' | 'dispute'>(initialTab);

  // Local form state for selections (before submitting)
  const [selectedLevel, setSelectedLevel] = useState<VerificationLevelOptions | null>(null);

  // Dispute form state
  const [severity, setSeverity] = useState<DisputeSeverity | null>(null);
  const [culpability, setCulpability] = useState<DisputeCulpability | null>(null);
  const [disputeNotes, setDisputeNotes] = useState('');

  // ============================================================
  // HANDLERS
  // ============================================================

  const handleSubmitVerification = () => {
    if (!selectedLevel) return;
    initiateVerification(selectedLevel);
  };

  const handleRetract = async () => {
    initiateRetractVerification();
  };

  const handleModifyLevel = async (newLevel: VerificationLevelOptions) => {
    if (verification) {
      initiateModifyVerification(verification.recordHash, newLevel);
    }
  };

  const handleSubmitDispute = async () => {
    if (severity === null || culpability === null) return;
    initiateDispute(severity, culpability, disputeNotes || undefined);
  };

  // ============================================================
  // COMPUTED
  // ============================================================

  const canSubmitVerification = selectedLevel !== null && !verification?.isActive;
  const canSubmitDispute = severity !== null && culpability !== null;
  const activeDispute = existingDispute?.isActive ? existingDispute : null;
  const activeVerification = verification?.isActive ? verification : null;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <GuestFeatureGate
      featureName="verify records"
      featureDescription="Write verifications or disputes for medical records to help others understand their credibility."
    >
      {' '}
      <div>
        {/* Hash Badge */}
        <div className="mx-5 my-4 px-4 py-3 bg-muted rounded-xl flex items-center justify-center gap-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Record Hash
          </span>
          <button onClick={onViewRecord} className="hover:underline cursor-pointer">
            <code className="text-xs font-mono text-foreground px-2">{recordHash}</code>
          </button>
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <HelpCircle className="w-4 h-4 text-blue-700 cursor-help" />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className="bg-gray-900 text-white rounded-lg p-4 max-w-sm shadow-xl z-50"
                  sideOffset={5}
                >
                  <p className="font-semibold mb-2 text-sm">
                    The record hash is the digital fingerprint of the current version of the record:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Your verification or dispute is tied to this hash specifically.</li>
                    <li>
                      If this record is changed, your review will not transfer to the new record.
                    </li>
                    <li>You may remove or edit your review at any time.</li>
                  </ol>
                  <Tooltip.Arrow className="fill-gray-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 px-5 mb-2">
          <button
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold rounded-xl transition-all',
              activeTab === 'verify'
                ? 'bg-complement-3 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
            onClick={() => setActiveTab('verify')}
          >
            <CheckCircle className="w-4 h-4" />
            Verify
          </button>
          <button
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold rounded-xl transition-all',
              activeTab === 'dispute'
                ? 'bg-red-700 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
            onClick={() => setActiveTab('dispute')}
          >
            <AlertTriangle className="w-4 h-4" />
            Dispute
          </button>
        </div>

        {/* Content */}
        <div className="p-5 min-h-[360px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : activeTab === 'verify' ? (
            <VerificationForm
              selectedLevel={selectedLevel}
              onSelectLevel={setSelectedLevel}
              verification={verification}
              onModify={handleModifyLevel}
              onRetract={handleRetract}
              isSubmitting={isLoading}
              existingDispute={existingDispute}
              initialModifying={initialModifyingVerification}
            />
          ) : (
            <DisputeForm
              severity={severity}
              culpability={culpability}
              notes={disputeNotes}
              onSelectSeverity={setSeverity}
              onSelectCulpability={setCulpability}
              onNotesChange={setDisputeNotes}
              existingDispute={activeDispute}
              initiateRetractDispute={initiateRetractDispute}
              initiateModifyDispute={initiateModifyDispute}
              isSubmitting={isLoading}
              initialModifying={initialModifyingDispute}
              existingVerification={verification}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-4 border-t border-border">
          <Button
            className={cn(
              'w-full py-3 text-sm font-semibold',
              activeTab === 'verify'
                ? 'bg-complement-3 hover:bg-complement-3/90'
                : 'bg-red-600 hover:bg-red-700'
            )}
            disabled={
              activeTab === 'verify'
                ? !canSubmitVerification || isLoading
                : !canSubmitDispute || isLoading
            }
            onClick={activeTab === 'verify' ? handleSubmitVerification : handleSubmitDispute}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                {activeTab === 'verify' ? 'Submit Verification' : 'Submit Dispute'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground text-center">
            Your review will be recorded on the blockchain and cannot be deleted. You can retract or
            modify it later.
          </p>
        </div>
      </div>
    </GuestFeatureGate>
  );
};

export default RecordReviewPanel;

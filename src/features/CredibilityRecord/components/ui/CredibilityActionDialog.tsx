// src/features/CredibilityRecord/components/ui/CredibilityActionDialog.tsx

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { ShieldCheck, ShieldAlert, XCircle, FileX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type {
  CredibilityOperationType,
  CredibilityPreparationProgress,
} from '@/features/CredibilityRecord/services/credibilityPreparationService';
import { getVerificationConfig } from '../../services/verificationService';
import {
  DisputeSeverity,
  getSeverityConfig,
  getCulpabilityConfig,
} from '../../services/disputeService';
import NetworkPreparingContent from '@/features/BlockchainWallet/components/NetworkPreparingContent';
import { OnChainSubmittedContent } from '@/features/OnChainActivityTray/components/OnChainSubmittedModal';
import { VerificationLevelOptions } from '../../hooks/useCredibilityFlow';
import { DisputeCulpability } from '@belrose/shared';

// ============================================================================
// TYPES
// ============================================================================

export type DialogPhase = 'idle' | 'preparing' | 'confirming' | 'executing' | 'submitted' | 'error';

interface CredibilityActionDialogProps {
  isOpen: boolean;
  phase: DialogPhase;
  operationType: CredibilityOperationType;
  error?: string | null;
  preparationProgress?: CredibilityPreparationProgress | null;
  // Pre-selected values from the form (if any)
  pendingLevel?: VerificationLevelOptions;
  pendingSeverity?: DisputeSeverity;
  pendingCulpability?: DisputeCulpability;
  pendingNotes?: string;
  onClose: () => void;
  onConfirmVerification: (level: VerificationLevelOptions) => void;
  onConfirmModifyVerification: (level: VerificationLevelOptions) => void;
  onConfirmRetract: () => void;
  onConfirmDispute: () => void;
  onConfirmModifyDispute: () => void;
  submittedLabel: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const CredibilityActionDialog: React.FC<CredibilityActionDialogProps> = ({
  isOpen,
  phase,
  operationType,
  error,
  preparationProgress,
  pendingLevel,
  pendingSeverity,
  pendingCulpability,
  pendingNotes,
  onClose,
  onConfirmVerification,
  onConfirmModifyVerification,
  onConfirmRetract,
  onConfirmDispute,
  onConfirmModifyDispute,
  submittedLabel,
}) => {
  if (!isOpen) return null;

  const canClose = phase === 'confirming' || phase === 'error' || phase === 'submitted';

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={open => !open && canClose && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl p-6 shadow-2xl z-[101] w-full max-w-md max-h-[90vh] overflow-y-auto">
          {/* Preparing Phase */}
          {phase === 'preparing' && (
            <NetworkPreparingContent
              progress={preparationProgress}
              steps={['computing', 'saving', 'registering', 'initializing_record', 'ensuring_hash']}
              title="Preparing Secure Network"
            />
          )}

          {/* Error Phase */}
          {phase === 'error' && <ErrorContent error={error} onClose={onClose} />}

          {/* Submitted Phase */}
          {phase === 'submitted' && (
            <OnChainSubmittedContent onClose={onClose} label={submittedLabel} />
          )}

          {/* Confirming Phase - Verification - Creation or Modification */}
          {phase === 'confirming' &&
            (operationType === 'verify' || operationType === 'modifyVerification') && (
              <ConfirmVerificationContent
                level={pendingLevel}
                isModify={operationType === 'modifyVerification'}
                onConfirm={
                  operationType === 'modifyVerification'
                    ? onConfirmModifyVerification
                    : onConfirmVerification
                }
              />
            )}

          {/* Confirming Phase - Retract Verification */}
          {phase === 'confirming' && operationType === 'retractVerification' && (
            <ConfirmRetractContent
              title="Retract Verification"
              description="Are you sure you want to retract your verification of this record?"
              warning="Retracting your verification will remove your endorsement from this record. This action is recorded on the distributed network."
              onConfirm={onConfirmRetract}
            />
          )}

          {/* Confirming Phase - Retract Dispute */}
          {phase === 'confirming' && operationType === 'retractDispute' && (
            <ConfirmRetractContent
              title="Retract Dispute"
              description="Are you sure you want to retract your dispute of this record?"
              warning="Retracting your dispute will remove your complaint from this record. This action is recorded on the distributed network."
              onConfirm={onConfirmRetract}
            />
          )}

          {/* Confirming Phase - Dispute (New or Modify) */}
          {phase === 'confirming' &&
            (operationType === 'dispute' || operationType === 'modifyDispute') &&
            pendingSeverity !== undefined &&
            pendingCulpability !== undefined && (
              <ConfirmDisputeContent
                severity={pendingSeverity}
                culpability={pendingCulpability}
                notes={pendingNotes}
                isModify={operationType === 'modifyDispute'}
                onConfirm={
                  operationType === 'modifyDispute' ? onConfirmModifyDispute : onConfirmDispute
                }
              />
            )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};

// ============================================================================
// PHASE CONTENT COMPONENTS
// ============================================================================

const ErrorContent: React.FC<{ error?: string | null; onClose: () => void }> = ({
  error,
  onClose,
}) => (
  <div className="flex flex-col items-center gap-4 py-4">
    <XCircle className="w-10 h-10 text-red-500" />
    <AlertDialog.Title className="text-lg font-bold text-center text-red-700">
      Something Went Wrong
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
// CONFIRM VERIFICATION CONTENT
// ============================================================================

const ConfirmVerificationContent: React.FC<{
  level?: VerificationLevelOptions;
  isModify?: boolean;
  onConfirm: (level: VerificationLevelOptions) => void;
}> = ({ level, isModify, onConfirm }) => {
  const config = getVerificationConfig(level || 1);
  const Icon = config.icon;

  return (
    <>
      <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-complement-3" />
        {isModify ? 'Modify Verification' : 'Confirm Verification'}
      </AlertDialog.Title>

      <AlertDialog.Description className="mt-3 text-sm text-gray-600">
        Review your selection before it is recorded to the secure network.
      </AlertDialog.Description>

      {/* Confirm Card */}
      <div className="my-2 p-4 border rounded-lg bg-complement-3/5 border-complement-3/20 flex items-start gap-3">
        <Icon className="w-6 h-6 text-complement-3 mt-1" />
        <div>
          <p className="font-bold text-gray-900">{config.name} Level</p>
          <p className="text-sm text-gray-600 italic">"{config.declarative}"</p>
        </div>
      </div>

      {/* CONSOLIDATED FOOTER */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
        <p className="text-xs text-amber-800 leading-relaxed">
          <strong>Note:</strong> By verifying this record, you are staking your personal and
          professional reputation on its accuracy.{' '}
          <span className="block mt-2">
            Belrose will report proven misconduct to the appropriate legal and professional
            authorities.
          </span>
        </p>
      </div>

      <div className="flex gap-3">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <Button
          onClick={() => level && onConfirm(level)}
          className="flex-1 bg-complement-3 hover:bg-complement-3/90"
          disabled={!level}
        >
          {isModify ? 'Confirm Modification' : 'Submit Verification'}
        </Button>
      </div>
    </>
  );
};

// ============================================================================
// CONFIRM RETRACT CONTENT (Reusable for both verification and dispute)
// ============================================================================

const ConfirmRetractContent: React.FC<{
  title: string;
  description: string;
  warning: string;
  onConfirm: () => void;
}> = ({ title, description, warning, onConfirm }) => (
  <>
    <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
      <FileX className="w-5 h-5 text-red-600" />
      {title}
    </AlertDialog.Title>

    <AlertDialog.Description className="mt-3 text-sm text-gray-600">
      {description}
    </AlertDialog.Description>

    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 my-4">
      <p className="text-xs text-amber-800">
        <strong>Note:</strong> {warning}
      </p>
    </div>

    <div className="flex gap-3">
      <AlertDialog.Cancel asChild>
        <Button variant="outline" className="flex-1">
          Cancel
        </Button>
      </AlertDialog.Cancel>
      <Button onClick={onConfirm} variant="destructive" className="flex-1">
        {title}
      </Button>
    </div>
  </>
);

// ============================================================================
// CONFIRM DISPUTE CONTENT
// ============================================================================

const ConfirmDisputeContent: React.FC<{
  severity: DisputeSeverity;
  culpability: DisputeCulpability;
  notes?: string;
  isModify?: boolean;
  onConfirm: () => void;
}> = ({ severity, culpability, notes, isModify, onConfirm }) => {
  const severityConfig = getSeverityConfig(severity || 1);
  const culpabilityConfig = getCulpabilityConfig(culpability || 0);

  return (
    <>
      <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-red-600" />
        {isModify ? 'Confirm Dispute Modification' : 'Confirm Dispute'}
      </AlertDialog.Title>

      <AlertDialog.Description className="mt-3 text-sm text-gray-600">
        Review your selection before it is recorded to the secure network.
      </AlertDialog.Description>

      {/* Dispute Details */}
      <div className="my-4 space-y-3">
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Severity</div>
          <div className="font-semibold text-gray-900">{severityConfig.name}</div>
          <div className="text-xs text-gray-500 mt-1">{severityConfig.declarative}</div>
        </div>

        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Culpability</div>
          <div className="font-semibold text-gray-900">{culpabilityConfig.name}</div>
          <div className="text-xs text-gray-500 mt-1">{culpabilityConfig.declarative}</div>
        </div>

        {notes && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{notes}</div>
          </div>
        )}
      </div>

      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
        <p className="text-xs text-red-800">
          <strong>Warning:</strong> Filing a dispute is a serious action. This will be permanently
          recorded on a secured digital network and visible to all participants.
        </p>
      </div>

      <div className="flex gap-3">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <Button onClick={onConfirm} variant="destructive" className="flex-1">
          {isModify ? 'Modify Dispute' : 'File Dispute'}
        </Button>
      </div>
    </>
  );
};

export default CredibilityActionDialog;

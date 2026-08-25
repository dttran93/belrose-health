// src/features/CredibilityUser/components/Vouches/VouchActionDialog.tsx

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { ShieldCheck, ShieldOff, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { OnChainSubmittedContent } from '@/features/OnChainActivityTray/components/OnChainSubmittedModal';
import NetworkPreparingContent from '@/features/BlockchainWallet/components/NetworkPreparingContent';
import type { VouchDialogPhase, VouchOperationType } from '../../hooks/useVouchFlow';

// ============================================================================
// TYPES
// ============================================================================

interface VouchActionDialogProps {
  isOpen: boolean;
  phase: VouchDialogPhase;
  operationType: VouchOperationType;
  targetDisplayName: string;
  error?: string | null;
  onClose: () => void;
  onConfirmVouch: () => void;
  onConfirmRetract: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const VouchActionDialog: React.FC<VouchActionDialogProps> = ({
  isOpen,
  phase,
  operationType,
  targetDisplayName,
  error,
  onClose,
  onConfirmVouch,
  onConfirmRetract,
}) => {
  if (!isOpen) return null;

  const canClose = phase === 'confirming' || phase === 'error' || phase === 'submitted';

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={open => !open && canClose && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl p-6 shadow-2xl z-[101] w-full max-w-md">
          {phase === 'preparing' && (
            <NetworkPreparingContent
              title="Preparing Secure Network"
              steps={['computing', 'saving', 'registering']}
            />
          )}

          {phase === 'error' && <ErrorContent error={error} onClose={onClose} />}

          {phase === 'submitted' && (
            <OnChainSubmittedContent
              onClose={onClose}
              label={operationType === 'vouch' ? 'Submitting vouch' : 'Retracting vouch'}
            />
          )}

          {phase === 'confirming' && operationType === 'vouch' && (
            <ConfirmVouchContent
              targetDisplayName={targetDisplayName}
              onConfirm={onConfirmVouch}
            />
          )}

          {phase === 'confirming' && operationType === 'retract' && (
            <ConfirmRetractContent
              targetDisplayName={targetDisplayName}
              onConfirm={onConfirmRetract}
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

const ConfirmVouchContent: React.FC<{
  targetDisplayName: string;
  onConfirm: () => void;
}> = ({ targetDisplayName, onConfirm }) => (
  <>
    <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
      <ShieldCheck className="w-5 h-5 text-complement-3" />
      Vouch for {targetDisplayName}
    </AlertDialog.Title>

    <AlertDialog.Description className="mt-3 text-sm text-gray-600">
      You are about to vouch for <strong>{targetDisplayName}</strong>. A vouch is a trust statement
      that contributes to this user's credibility score across the Belrose network.
    </AlertDialog.Description>

    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 my-4">
      <p className="text-xs text-amber-800 leading-relaxed">
        <strong>Note:</strong> This action is permanently recorded on the distributed network. You
        may retract your vouch at any time.
      </p>
    </div>

    <div className="flex gap-3">
      <AlertDialog.Cancel asChild>
        <Button variant="outline" className="flex-1">
          Cancel
        </Button>
      </AlertDialog.Cancel>
      <Button onClick={onConfirm} className="flex-1 bg-complement-3 hover:bg-complement-3/90">
        Confirm Vouch
      </Button>
    </div>
  </>
);

const ConfirmRetractContent: React.FC<{
  targetDisplayName: string;
  onConfirm: () => void;
}> = ({ targetDisplayName, onConfirm }) => (
  <>
    <AlertDialog.Title className="text-lg font-bold flex items-center gap-2">
      <ShieldOff className="w-5 h-5 text-red-600" />
      Retract Vouch for {targetDisplayName}
    </AlertDialog.Title>

    <AlertDialog.Description className="mt-3 text-sm text-gray-600">
      You are about to retract your vouch for <strong>{targetDisplayName}</strong>. This will remove
      your endorsement from their credibility score.
    </AlertDialog.Description>

    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 my-4">
      <p className="text-xs text-amber-800">
        <strong>Note:</strong> The retraction will be permanently recorded on the distributed
        network. You may vouch for this user again in the future.
      </p>
    </div>

    <div className="flex gap-3">
      <AlertDialog.Cancel asChild>
        <Button variant="outline" className="flex-1">
          Cancel
        </Button>
      </AlertDialog.Cancel>
      <Button onClick={onConfirm} variant="destructive" className="flex-1">
        Retract Vouch
      </Button>
    </div>
  </>
);

export default VouchActionDialog;

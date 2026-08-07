// src/features/GuestAccess/components/GuestUploadBlockerModal.tsx

/**
 * This component is shown to guest users when they attempt to navigate away from an unsecured
 * upload — whether that's AddRecord right after uploading, or RecordFull while reviewing a
 * record they uploaded earlier (see useGuestUploadBlocker, used by both).
 * Guests are given temporary AES keys as part of the Encryption Manager and to be able to login.
 */

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Lock, Send, UserPlus, AlertTriangle } from 'lucide-react';
import { RecordRequest } from '@belrose/shared';
import { FileObject } from '@/types/core';
import { truncate } from '@/utils/dataFormattingUtils';
import ActionButton from '@/components/ui/ActionButton';

interface GuestUploadBlockerModalProps {
  pendingRequest: RecordRequest | null;
  completedFiles: FileObject[];
  onClaim: () => void;
  onFulfillAndExit: () => void;
  onLeave: () => void;
}

export const GuestUploadBlockerModal: React.FC<GuestUploadBlockerModalProps> = ({
  pendingRequest,
  completedFiles,
  onClaim,
  onFulfillAndExit,
  onLeave,
}) => {
  const fileCount = completedFiles.length;
  const fileName = fileCount === 1 ? completedFiles[0]?.fileName : undefined;

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]" />
        <Dialog.Content
          // Prevent closing via Escape or clicking outside — this is a hard blocker
          onEscapeKeyDown={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     bg-white rounded-2xl shadow-2xl z-[201] w-full max-w-md
                     overflow-hidden"
        >
          {/* ── Header ── */}
          <div className="bg-amber-50 border-b border-amber-100 px-6 py-5 flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <Dialog.Title className="text-base font-bold text-slate-900">
                Before you leave
              </Dialog.Title>
              <Dialog.Description className="text-sm text-slate-500 mt-0.5">
                {fileCount === 1 && fileName
                  ? `"${truncate(fileName, 40)}" is uploaded but not yet secured.`
                  : `${fileCount} uploaded file${fileCount > 1 ? 's are' : ' is'} not yet secured.`}
              </Dialog.Description>
            </div>
          </div>

          <div className="px-6 py-5 space-y-3">
            {/* ── Encryption warning pill ── */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <p className="text-xs text-slate-500">
                Your guest session uses a temporary key.{' '}
                <span className="font-medium text-slate-700">
                  Leaving without an account means you'll lose access to this record permanently.
                </span>
              </p>
            </div>

            {/* ── Primary action: Send to requester (only if pendingRequest exists) ── */}
            {/* ── Create account ── */}
            <ActionButton
              icon={<UserPlus className="w-4 h-4 text-white" />}
              label="Create a free account"
              sublabel="Keep permanent access to this record and unlock all features"
              onClick={onClaim}
              variant="primary"
            />

            {pendingRequest && (
              <ActionButton
                icon={<Send className="w-4 h-4 text-white" />}
                label={`Send to ${pendingRequest.requesterName}`}
                sublabel={`Fulfil ${pendingRequest.requesterName}'s request and exit`}
                onClick={onFulfillAndExit}
                variant="secondary"
              />
            )}

            {/* ── Leave anyway (only when no pending request) ── */}
            {!pendingRequest && (
              <button
                onClick={onLeave}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600
                           transition-colors py-2"
              >
                Leave anyway — I understand I'll lose record access
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

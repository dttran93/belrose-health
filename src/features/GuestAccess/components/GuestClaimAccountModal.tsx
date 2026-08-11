// src/features/GuestAccess/components/GuestClaimAccountModal.tsx

/**
 * GuestClaimAccountModal
 *
 * UI shell for converting a temporary guest session into a permanent Belrose account. Owns
 * form/step state and progress display; the actual orchestration (Firestore writes, key
 * rewrapping, Cloud Function calls, blockchain registration) lives in GuestClaimService — see
 * that file's header comment for the full write-strategy rationale (why each step is
 * batched/standalone, atomic/best-effort, and ordered the way it is).
 */

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuthContext } from '@/features/Auth/AuthContext';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import {
  AccountEncryptionService,
  EncryptionBootstrapBundle,
} from '@/features/Auth/services/accountEncryptionService';
import { GuestClaimService } from '@/features/GuestAccess/services/guestClaimService';
import { RecoveryKeyDisplay } from '@/features/Auth/components/RecoveryKeyDisplay';
import { toast } from 'sonner';
import InputField from '@/components/ui/InputField';
import PasswordStrengthIndicator from '@/features/Auth/components/ui/PasswordStrengthIndicator';

type ClaimStep = 'credentials' | 'recovery' | 'processing' | 'done';

interface ClaimProgress {
  message: string;
}

interface GuestClaimAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  guestContext?: 'sharing' | 'record_request';
}

export const GuestClaimAccountModal: React.FC<GuestClaimAccountModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  guestContext,
}) => {
  const { user, refreshUser } = useAuthContext();

  if (!user) {
    throw new Error('GuestClaimAccountModal must be used within an authenticated guest account');
  }

  const [step, setStep] = useState<ClaimStep>('credentials');
  const [progress, setProgress] = useState<ClaimProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Generated crypto data — held in state between steps
  const [cryptoData, setCryptoData] = useState<EncryptionBootstrapBundle | null>(null);

  const handleCredentialsSubmit = async () => {
    if (!firstName || !lastName || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (guestContext !== 'record_request' && !EncryptionKeyManager.hasGuestFileKeys()) {
      setError(
        'Your session has expired. Please click the invite link again before creating an account.'
      );
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const bundle = await AccountEncryptionService.generateEncryptionBundle(password);

      setCryptoData(bundle);
      setRecoveryKey(bundle.recoveryKey);
      setStep('recovery');
    } catch (err: any) {
      setError(err.message || 'Failed to set up encryption. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClaim = async () => {
    if (!acknowledged || !cryptoData) return;

    setStep('processing');
    setError(null);

    try {
      const { skippedRecordCount } = await GuestClaimService.claimAccount(
        {
          guestUid: user.uid,
          guestEmail: user.email,
          firstName,
          lastName,
          password,
          guestContext,
          cryptoData,
          // AuthContext's refreshUser is loosely typed (() => {}) even though it's actually
          // async — wrap it so the service's stricter () => Promise<void> param is satisfied.
          refreshUser: async () => {
            await refreshUser();
          },
        },
        message => setProgress({ message })
      );

      // Warn if any uploaded records couldn't be rewrapped (Step 1c failures)
      if (skippedRecordCount > 0) {
        toast.warning(
          `${skippedRecordCount} uploaded record${skippedRecordCount > 1 ? 's' : ''} couldn't be secured`,
          {
            description:
              'Your session expired before we could secure access. These records were uploaded successfully but you may not be able to view them. You can re-upload them from your account.',
            duration: 8000,
          }
        );
      }

      setStep('done');
      toast.success('Welcome to Belrose!', {
        description: 'Your account has been created successfully.',
      });
    } catch (err: any) {
      console.error('❌ Claim failed:', err);
      setError(err.message || 'Something went wrong. Please try again.');
      setStep('recovery');
    }
  };

  // ── Modal lifecycle ────────────────────────────────────────────────────────

  const handleClose = () => {
    if (step === 'processing') return; // Don't allow closing during processing
    setStep('credentials');
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setCryptoData(null);
    setAcknowledged(false);
    onClose();
  };

  const handleDone = () => {
    setStep('credentials');
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setCryptoData(null);
    setAcknowledged(false);
    // If caller provided onComplete, use it — otherwise fall back to onClose
    if (onComplete) {
      onComplete();
    } else {
      onClose();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
                     bg-white rounded-2xl shadow-2xl z-[201] w-full max-w-lg max-h-[90vh] 
                     overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div>
              <Dialog.Title className="text-lg font-bold text-slate-900">
                Create Your Account
              </Dialog.Title>
              <Dialog.Description className="text-sm text-slate-500 mt-0.5">
                Turn your guest access into a permanent account
              </Dialog.Description>
            </div>
            {step !== 'processing' && (
              <button
                onClick={handleClose}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            )}
          </div>

          {/* Step indicator */}
          {(step === 'credentials' || step === 'recovery') && (
            <div className="flex items-center gap-3 px-6 pt-4">
              <div
                className={`flex items-center gap-2 text-xs font-medium ${
                  step === 'credentials' ? 'text-amber-600' : 'text-green-600'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs
                  ${step === 'credentials' ? 'bg-amber-500' : 'bg-green-500'}`}
                >
                  {step === 'recovery' ? <Check className="w-3 h-3" /> : '1'}
                </div>
                Account Details
              </div>
              <div className="flex-1 h-px bg-slate-200" />
              <div
                className={`flex items-center gap-2 text-xs font-medium ${
                  step === 'recovery' ? 'text-amber-600' : 'text-slate-400'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs
                  ${step === 'recovery' ? 'bg-amber-500' : 'bg-slate-300'}`}
                >
                  2
                </div>
                Recovery Key
              </div>
            </div>
          )}

          <div className="p-6">
            {/* ── Step 1: Credentials ── */}
            {step === 'credentials' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      First Name
                    </label>
                    <InputField
                      type="text"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      className="px-3 py-2 text-sm"
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      Last Name
                    </label>
                    <InputField
                      type="text"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      className="px-3 py-2 text-sm"
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Email</label>
                  <InputField
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    ✓ Already verified via your invite link
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Password</label>
                  <InputField
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="px-3 py-2 text-sm"
                    placeholder="At least 8 characters"
                  />
                </div>

                <PasswordStrengthIndicator password={password} />

                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Confirm Password
                  </label>
                  <InputField
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="px-3 py-2 text-sm"
                    placeholder="Repeat your password"
                    onKeyDown={e => e.key === 'Enter' && handleCredentialsSubmit()}
                  />
                </div>

                {error && (
                  <p
                    className="text-xs text-red-600 bg-red-50 border border-red-200 
                                rounded-lg px-3 py-2"
                  >
                    {error}
                  </p>
                )}

                <Button
                  onClick={handleCredentialsSubmit}
                  disabled={isGenerating}
                  className="w-full"
                >
                  {isGenerating ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up encryption...
                    </span>
                  ) : (
                    'Continue →'
                  )}
                </Button>
              </div>
            )}

            {/* ── Step 2: Recovery Key ── */}
            {step === 'recovery' && (
              <div className="space-y-4">
                <RecoveryKeyDisplay
                  recoveryKey={recoveryKey}
                  onAcknowledge={setAcknowledged}
                  onComplete={handleClaim}
                  isCompleted={acknowledged}
                  isActivated={true}
                />
                {error && (
                  <p
                    className="text-xs text-red-600 bg-red-50 border border-red-200 
                                rounded-lg px-3 py-2"
                  >
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* ── Processing ── */}
            {step === 'processing' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
                <p className="font-semibold text-slate-800">Creating your account...</p>
                {progress && (
                  <p className="text-sm text-slate-500 text-center">{progress.message}</p>
                )}
              </div>
            )}

            {/* Done */}
            {step === 'done' && (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                  <Check className="w-7 h-7 text-green-600" />
                </div>
                <h3 className="font-bold text-slate-900 text-lg">Welcome to Belrose!</h3>
                <p className="text-sm text-slate-500 max-w-xs">
                  Your account is ready. You now have full access to all features.
                </p>
                <Button onClick={handleDone} className="mt-2">
                  Get Started
                </Button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

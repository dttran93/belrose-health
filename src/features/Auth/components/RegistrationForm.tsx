// /features/Auth/components/RegistrationForm.tsx

import React, { useState } from 'react';
import { Check, ShieldCheck, ArrowRight, ArrowLeft, RotateCcwKey } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import BelroseAccountForm from './BelroseAccountForm';
import { RecoveryKeyDisplay } from './RecoveryKeyDisplay';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { AccountEncryptionService } from '../services/accountEncryptionService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import RegistrationProgressDialog, {
  RegistrationPhase,
  RegistrationProgress,
} from './ui/RegistrationProgressDialog';

interface StepConfig {
  number: number;
  title: string;
  subtitle: string;
  icon: typeof ShieldCheck;
}

interface RegistrationFormProps {
  onSwitchToLogin: () => void;
}

const RegistrationForm: React.FC<RegistrationFormProps> = ({ onSwitchToLogin }) => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [dialogPhase, setDialogPhase] = useState<RegistrationPhase>('idle');
  const [registrationProgress, setRegistrationProgress] = useState<RegistrationProgress | null>(
    null
  );
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isStep1Loading, setIsStep1Loading] = useState(false);

  // Store data from all steps
  const [registrationData, setRegistrationData] = useState({
    userId: '',
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    walletAddress: '',
    walletType: '' as 'generated' | 'metamask' | undefined,
    smartAccountAddress: '',
    recoveryKey: '',
    recoveryKeyHash: '',
    acknowledgedRecoveryKey: false,
    walletGenerationComplete: false,
    encryptedMasterKey: '',
    masterKeyIV: '',
    masterKeySalt: '',
    publicKey: '',
    encryptedPrivateKey: '',
    encryptedPrivateKeyIV: '',
  });

  const steps: StepConfig[] = [
    {
      number: 1,
      title: 'Account Creation',
      subtitle: 'Create your secure Belrose account',
      icon: ShieldCheck,
    },
    {
      number: 2,
      title: 'Recovery Key',
      subtitle: 'Save your recovery key for your encryption and network access',
      icon: RotateCcwKey,
    },
  ];

  const isStepCompleted = (stepNumber: number): boolean => {
    switch (stepNumber) {
      case 1:
        //Step 1 is done if we have a userId and email
        return !!(
          registrationData.userId &&
          registrationData.email &&
          registrationData.walletGenerationComplete
        );
      case 2:
        // Step 3 is completed if a recovery Key has been created/saved and acknowledged Recovery Key.
        return !!registrationData.acknowledgedRecoveryKey;
      default:
        return false;
    }
  };

  const canCompleteRegistration = (): boolean => {
    return isStepCompleted(1) && isStepCompleted(2);
  };

  const handleStepComplete = async (stepNumber: number, data: any) => {
    // If completing step 1, generate and encrypt the master key. Generate Wallet/SmartAccount and register on chain
    if (stepNumber === 1 && data.password) {
      setIsStep1Loading(true);
      try {
        console.log('🔐 Setting up encryption...');

        // 1-5. Generate master key, wrap with password, recovery key, RSA keypair
        const bundle = await AccountEncryptionService.generateEncryptionBundle(data.password);
        console.log('✓ Crypto material generated');

        // 6. Store master key in session
        EncryptionKeyManager.setSessionKey(bundle.masterKey);

        // 7. Generate wallet + register both wallets on-chain in one transaction — best-effort,
        // tracked via BlockchainSyncQueueService. Does not block registration from completing: a
        // failure here just means the account proceeds without a wallet, picked up later by
        // reconciliation, same as every other best-effort blockchain write in the app (see
        // GuestClaimService for the same pattern on the guest-claim side).
        console.log('💼 Generating wallet and registering on-chain...');
        let walletAddress = '';
        let smartAccountAddress = '';
        const syncRef = await BlockchainSyncQueueService.startAttempt({
          contract: 'MemberRoleManager',
          action: 'registerMemberOnChainComplete',
          userId: data.userId,
          context: { type: 'memberRegistry', newStatus: 'Active' },
        });
        try {
          const registrationResult = await AccountEncryptionService.registerWalletOnChain(
            bundle.masterKey
          );
          walletAddress = registrationResult.walletAddress;
          smartAccountAddress = registrationResult.smartAccountAddress;
          console.log('✓ Wallet generated and registered:', walletAddress);
          await BlockchainSyncQueueService.recordSuccess(syncRef, {
            txHash: registrationResult.blockchainRef.txHash,
            blockNumber: registrationResult.blockchainRef.blockNumber,
          });
        } catch (chainError) {
          console.error('❌ Wallet registration failed — proceeding without a wallet:', chainError);
          const errorMessage = getUserFacingErrorMessage(
            chainError,
            'Blockchain transaction failed'
          );
          await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
        }

        // 8. Single state update with everything — walletGenerationComplete now means "step 1
        // processing finished," not "the chain call succeeded"; it still gates whether the user
        // can move on to step 2, and a chain failure shouldn't strand them there.
        setRegistrationData(prev => ({
          ...prev,
          ...data,
          encryptedMasterKey: bundle.encryptedMasterKey,
          masterKeyIV: bundle.masterKeyIV,
          masterKeySalt: bundle.masterKeySalt,
          recoveryKey: bundle.recoveryKey,
          recoveryKeyHash: bundle.recoveryKeyHash,
          publicKey: bundle.publicKey,
          encryptedPrivateKey: bundle.encryptedPrivateKey,
          encryptedPrivateKeyIV: bundle.encryptedPrivateKeyIV,
          walletAddress,
          smartAccountAddress,
          walletType: 'generated',
          walletGenerationComplete: true,
        }));

        if (walletAddress) {
          toast.success('Account and encryption setup complete!', {
            description: 'Your security is configured',
          });
        } else {
          toast.warning('Account and encryption set up — network registration pending', {
            description:
              "We'll finish setting up your distributed network account shortly. You can continue in the meantime.",
          });
        }
      } catch (error) {
        console.error('❌ Error setting up encryption:', error);
        toast.error('Failed to set up encryption');
        return; // Don't proceed if encryption setup fails
      } finally {
        setIsStep1Loading(false);
      }
    } else {
      setRegistrationData(prev => ({ ...prev, ...data }));
    }

    // If last step, trigger complete registration. Else go to next step.
    if (stepNumber === steps.length) {
      setTimeout(() => handleCompleteRegistration(), 0);
    } else {
      setCurrentStep(stepNumber + 1);
    }
  };

  const handleCompleteRegistration = async () => {
    if (!canCompleteRegistration()) {
      toast.error('Please complete all steps before continuing');
      return;
    }

    // Prevent double-clicks
    if (isSubmitting) return;
    setIsSubmitting(true);
    setDialogPhase('registering');
    setDialogError(null);

    try {
      console.log('🔄 Completing registration...');

      // Wallet + blockchain registration already done in step 1

      // 1. Save core account data to Firestore
      setRegistrationProgress({
        step: 'firestore_update',
        message: 'Finalizing your account...',
      });

      const db = getFirestore();
      const userDocRef = doc(db, 'users', registrationData.userId);

      await updateDoc(userDocRef, {
        email: registrationData.email,
        firstName: registrationData.firstName,
        lastName: registrationData.lastName,
        encryption: {
          enabled: true,
          encryptedMasterKey: registrationData.encryptedMasterKey,
          masterKeyIV: registrationData.masterKeyIV,
          masterKeySalt: registrationData.masterKeySalt,
          encryptedPrivateKey: registrationData.encryptedPrivateKey,
          encryptedPrivateKeyIV: registrationData.encryptedPrivateKeyIV,
          publicKey: registrationData.publicKey,
          recoveryKeyHash: registrationData.recoveryKeyHash,
          setupAt: new Date().toISOString(),
        },

        // Verification fields will be updated later in the verification flow
        emailVerified: false,
        identityVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 2. Update invite doc if applicable
      try {
        const inviteRef = doc(db, 'invites', registrationData.email.toLowerCase());
        await updateDoc(inviteRef, {
          registeredUserId: registrationData.userId,
          registeredAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Could not update invite doc — may not exist or no permission:', e);
      }

      setRegistrationProgress({ step: 'complete', message: 'Registration complete!' });
      setDialogPhase('success');
    } catch (error) {
      console.error('❌ Registration failed:', error);
      setDialogError(error instanceof Error ? error.message : 'Unknown error occurred');
      setDialogPhase('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDialogClose = () => {
    if (dialogPhase === 'success') {
      navigate('/verification', {
        replace: true,
        state: {
          userId: registrationData.userId,
          email: registrationData.email,
          fromRegistration: true,
        },
      });
    }
    setDialogPhase('idle');
  };

  const handleRecoveryKeyAcknowledged = (acknowledged: boolean) => {
    setRegistrationData(prev => ({
      ...prev,
      acknowledgedRecoveryKey: acknowledged,
    }));
  };

  return (
    <div className="min-h-screen bg-secondary from-blue-50 to-indigo-100 flex">
      {/* LEFT SIDE - Progress Tracker */}
      <div className="w-1/3 2xl:w-1/4 bg-primary p-12 flex flex-col justify-between">
        <div>
          <h1 className="text-3xl font-bold text-secondary mb-2">Join Belrose</h1>
          <p className="text-secondary mb-12">
            It takes less than 5 minutes to create your secure health data platform
          </p>

          {/* Progress Steps */}
          <div className="space-y-8">
            {steps.map(step => {
              const Icon = step.icon;
              const isCompleted = isStepCompleted(step.number);
              const isCurrent = step.number === currentStep;

              return (
                <div key={step.number} className="flex items-start space-x-4">
                  {/* Step Circle */}
                  <div
                    className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isCompleted
                        ? 'bg-complement-3'
                        : isCurrent
                          ? 'bg-complement-4'
                          : 'bg-secondary'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-6 h-6 text-primary" />
                    ) : (
                      <Icon className="w-6 h-6 text-primary" />
                    )}
                  </div>

                  {/* Step Content */}
                  <div className="flex-1">
                    <div
                      className={`font-semibold transition-all duration-300 ${
                        isCompleted
                          ? `text-complement-3`
                          : isCurrent
                            ? 'text-complement-4 text-lg'
                            : 'text-secondary text-base'
                      }`}
                    >
                      {step.title}
                    </div>
                    {isCurrent && (
                      <p
                        className={`text-sm mt-1 ${isCompleted ? `text-complement-3` : `text-complement-4`}`}
                      >
                        {step.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE - Content Area */}
      <div className="flex-1 p-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-lg mb-14">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Render current step */}
            {currentStep === 1 && (
              <BelroseAccountForm
                onComplete={data => handleStepComplete(1, data)}
                initialData={registrationData}
                isCompleted={isStepCompleted(1)}
                isExternallyLoading={isStep1Loading}
                onLoadingChange={(isLoading, message) => {
                  if (message) {
                    console.log('Loading:', message);
                  }
                }}
              />
            )}
            {currentStep === 2 && (
              <RecoveryKeyDisplay
                recoveryKey={registrationData.recoveryKey}
                onAcknowledge={handleRecoveryKeyAcknowledged}
                onComplete={handleCompleteRegistration}
                isCompleted={isStepCompleted(2)}
                isActivated={isStepCompleted(1)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-primary shadow-lg px-12 py-3">
        <div className="flex items-center justify-between">
          {/* Left side - Step indicator and Progress Bar*/}
          <div className="flex justify-between items-center w-1/5">
            <div className="flex flex-col text-xs text-secondary flex-shrink-0 whitespace-nowrap">
              <span>Step</span>
              <span>
                {currentStep} of {steps.length}
              </span>
            </div>

            <div className="w-full bg-complement-4 rounded-full h-2 mx-3">
              <div
                className="bg-complement-3 h-2 rounded-full transition-all duration-500"
                style={{ width: `${(currentStep / steps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Right side - Navigation buttons */}
          <div className="flex items-center space-x-4">
            <div className="flex text-white mx-3 items-center">
              <span className="text-sm">Already have an account?</span>
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="ml-2 text-destructive font-medium hover:underline transition-colors"
              >
                Sign in
              </button>
            </div>
            <Button
              onClick={() => setCurrentStep(Math.max(currentStep - 1, 1))}
              disabled={currentStep === 1}
              className="px-4 py-2 rounded-lg hover:bg-secondary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Button
              onClick={() => setCurrentStep(Math.min(currentStep + 1, 2))}
              disabled={currentStep === 2}
              className="px-4 py-2 rounded-lg hover:bg-secondary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowRight className="w-5 h-5" />
            </Button>
            <Button
              variant="secondary"
              type="submit"
              onClick={handleCompleteRegistration}
              disabled={!canCompleteRegistration()}
              className="rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              <span>Complete Registration</span>
            </Button>
          </div>
        </div>
      </footer>

      {/*Registration Progress Dialog for Loading State/Blockchain Update */}
      <RegistrationProgressDialog
        isOpen={dialogPhase !== 'idle'}
        phase={dialogPhase}
        progress={registrationProgress}
        error={dialogError}
        onClose={handleDialogClose}
        onRetry={handleCompleteRegistration}
      />
    </div>
  );
};

export default RegistrationForm;

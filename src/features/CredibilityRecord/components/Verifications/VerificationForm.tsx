// src/features/CredibilityRecord/components/ui/VerificationForm.tsx

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/utils';
import { CheckCircle, Loader2, Undo2, Edit2, AlertTriangle } from 'lucide-react';
import { VERIFICATION_OPTIONS, getVerificationConfig } from '../../services/verificationService';
import { DisputeDoc, VerificationDoc, VerificationLevelOptions } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

interface VerificationFormProps {
  selectedLevel: VerificationLevelOptions | null;
  onSelectLevel: (level: VerificationLevelOptions) => void;
  verification: VerificationDoc | null;
  onModify?: (newLevel: VerificationLevelOptions) => Promise<void>;
  onRetract?: () => Promise<void>;
  isSubmitting?: boolean;
  existingDispute?: DisputeDoc | null;
  initialModifying?: boolean;
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

interface LevelSelectorProps {
  selectedLevel: VerificationLevelOptions | null;
  onSelectLevel: (level: VerificationLevelOptions) => void;
  disabled?: boolean;
  currentLevel?: VerificationLevelOptions;
}

const LevelSelector: React.FC<LevelSelectorProps> = ({
  selectedLevel,
  onSelectLevel,
  disabled,
  currentLevel,
}) => (
  <div className="space-y-3">
    {VERIFICATION_OPTIONS.map(level => {
      const isSelected = selectedLevel === level.value;
      const isCurrent = currentLevel === level.value;
      const IconComponent = level.icon;

      return (
        <button
          key={level.value}
          disabled={disabled}
          className={cn(
            'w-full p-4 text-left border-2 rounded-xl transition-all',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isSelected
              ? 'border-complement-3 bg-complement-3/5'
              : isCurrent
                ? 'border-blue-500 bg-blue-50'
                : 'border-border hover:border-complement-3/50 bg-background'
          )}
          onClick={() => onSelectLevel(level.value)}
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center',
                isSelected
                  ? 'bg-complement-3/20 text-complement-3'
                  : isCurrent
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              <IconComponent className="w-5 h-5" />
            </div>
            <span className="flex-1 font-semibold text-primary">
              {level.name}
              {isCurrent && !isSelected && (
                <span className="ml-2 text-xs font-normal text-blue-600">(current)</span>
              )}
            </span>
            {isSelected && (
              <div className="w-6 h-6 bg-complement-3 text-white rounded-full flex items-center justify-center">
                <CheckCircle className="w-4 h-4" />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground italic">{level.declarative}</p>
        </button>
      );
    })}
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================

const VerificationForm: React.FC<VerificationFormProps> = ({
  selectedLevel,
  onSelectLevel,
  verification,
  onModify,
  onRetract,
  isSubmitting = false,
  existingDispute = null,
  initialModifying = false,
}) => {
  const [isModifying, setIsModifying] = useState(false);
  const [modifyLevel, setModifyLevel] = useState<VerificationLevelOptions | null>(
    initialModifying ? verification?.level || null : null
  );

  useEffect(() => {
    setIsModifying(initialModifying);
    if (initialModifying && verification) {
      setModifyLevel(verification.level);
    }
  }, [initialModifying, verification]);

  const handleStartModify = () => {
    setIsModifying(true);
    setModifyLevel(verification?.level || null);
  };

  const handleCancelModify = () => {
    setIsModifying(false);
    setModifyLevel(null);
  };

  const handleConfirmModify = async () => {
    if (!modifyLevel || modifyLevel === verification?.level) return;
    await onModify?.(modifyLevel);
    setIsModifying(false);
    setModifyLevel(null);
  };

  const handleRetract = async () => {
    if (!confirm('Are you sure you want to retract your verification?')) return;
    await onRetract?.();
  };

  // ============================================================
  // MUTUAL EXCLUSIVITY CHECK
  // ============================================================

  if (existingDispute?.isActive) {
    return (
      <div className="text-center py-10">
        <div className="w-16 h-16 mx-auto mb-5 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-primary mb-2">
          You've already disputed this record
        </h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
          You cannot verify a record you have disputed. To add a verification, please retract your
          dispute first from the Dispute tab.
        </p>
      </div>
    );
  }

  // ============================================================
  // MODIFY VIEW
  // ============================================================

  if (isModifying && verification) {
    return (
      <div>
        <h3 className="text-base font-semibold text-primary mb-1">Modify Verification Level</h3>
        <p className="text-sm text-foreground mb-5">
          Current level: <strong>{getVerificationConfig(verification.level).name}</strong>. Select a
          new level.
        </p>

        <LevelSelector
          selectedLevel={modifyLevel}
          onSelectLevel={setModifyLevel}
          disabled={isSubmitting}
          currentLevel={verification.level}
        />

        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            onClick={handleCancelModify}
            disabled={isSubmitting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmModify}
            disabled={isSubmitting || !modifyLevel || modifyLevel === verification.level}
            className="flex-1 bg-complement-3 hover:bg-complement-3/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Updating...
              </>
            ) : (
              'Confirm Change'
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // EXISTING VERIFICATION VIEW
  // ============================================================

  if (verification?.isActive) {
    const formattedDate = verification.createdAt.toDate().toLocaleDateString();

    return (
      <div className="text-center py-10">
        <div className="w-16 h-16 mx-auto mb-5 bg-complement-3/10 text-complement-3 rounded-full flex items-center justify-center">
          <CheckCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-primary mb-2">You've verified this record</h3>
        <p className="text-sm text-foreground mb-1">
          Level: <strong>{getVerificationConfig(verification.level).name}</strong>
        </p>
        <p className="text-xs text-muted-foreground mb-6">Verified on {formattedDate}</p>

        <div className="flex gap-3 justify-center">
          <Button
            variant="outline"
            className="border-complement-3 text-complement-3 hover:bg-complement-3/10"
            onClick={handleStartModify}
            disabled={isSubmitting}
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Modify Level
          </Button>
          <Button onClick={handleRetract} disabled={isSubmitting}>
            <Undo2 className="w-4 h-4 mr-2" />
            Retract
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // NEW VERIFICATION VIEW
  // ============================================================

  return (
    <div>
      <h3 className="text-base font-semibold text-primary mb-1">What can you verify?</h3>
      <p className="text-sm text-foreground mb-5">
        Select the level of verification you can provide for this record.
      </p>

      <LevelSelector
        selectedLevel={selectedLevel}
        onSelectLevel={onSelectLevel}
        disabled={isSubmitting}
      />
    </div>
  );
};

export default VerificationForm;

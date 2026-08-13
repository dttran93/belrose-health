import React, { useState } from 'react';
import { cn } from '@/utils/utils';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, Loader2, Undo2, Edit2, CheckCircle } from 'lucide-react';
import {
  CULPABILITY_OPTIONS,
  DisputeSeverity,
  SEVERITY_OPTIONS,
} from '../../services/disputeService';
import { DisputeCulpability, DisputeDoc, VerificationDoc } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

interface DisputeFormProps {
  severity: DisputeSeverity | null;
  culpability: DisputeCulpability | null;
  notes: string;
  onSelectSeverity: (severity: DisputeSeverity) => void;
  onSelectCulpability: (culpability: DisputeCulpability) => void;
  onNotesChange: (notes: string) => void;
  existingDispute: DisputeDoc | null;
  initiateRetractDispute: (recordHash?: string) => Promise<void>;
  initiateModifyDispute: (
    recordHash: string,
    newSeverity?: DisputeSeverity,
    newCulpability?: DisputeCulpability
  ) => Promise<void>;
  isSubmitting?: boolean;
  initialModifying?: boolean;
  existingVerification?: VerificationDoc | null;
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

interface SeveritySelectorProps {
  selectedSeverity: DisputeSeverity | null;
  onSelectSeverity: (severity: DisputeSeverity) => void;
  disabled?: boolean;
  currentSeverity?: DisputeSeverity;
}

const SeveritySelector: React.FC<SeveritySelectorProps> = ({
  selectedSeverity,
  onSelectSeverity,
  disabled,
  currentSeverity,
}) => (
  <div className="grid grid-cols-3 gap-3">
    {SEVERITY_OPTIONS.map(level => {
      const isSelected = selectedSeverity === level.value;
      const isCurrent = currentSeverity === level.value;

      return (
        <button
          key={level.value}
          disabled={disabled}
          className={cn(
            'p-4 text-center border-2 rounded-xl transition-all',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isSelected
              ? 'border-red-500 bg-red-100'
              : isCurrent
                ? 'border-blue-500 bg-blue-50'
                : 'border-border hover:border-red-300 bg-background'
          )}
          onClick={() => onSelectSeverity(level.value)}
        >
          <span className="block text-sm font-semibold text-primary">
            {level.name}
            {isCurrent && !isSelected && (
              <span className="ml-1 text-xs font-normal text-blue-600">(current)</span>
            )}
          </span>
          <span className="block text-[10px] text-muted-foreground mt-1 leading-tight">
            {level.description}
          </span>
        </button>
      );
    })}
  </div>
);

interface CulpabilitySelectorProps {
  selectedCulpability: DisputeCulpability | null;
  onSelectCulpability: (culpability: DisputeCulpability) => void;
  disabled?: boolean;
  currentCulpability?: DisputeCulpability;
}

const CulpabilitySelector: React.FC<CulpabilitySelectorProps> = ({
  selectedCulpability,
  onSelectCulpability,
  disabled,
  currentCulpability,
}) => (
  <div className="space-y-2">
    {CULPABILITY_OPTIONS.map(level => {
      const isSelected = selectedCulpability === level.value;
      const isCurrent = currentCulpability === level.value;

      return (
        <button
          key={level.value}
          disabled={disabled}
          className={cn(
            'w-full flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isSelected
              ? 'border-red-700 bg-red-100'
              : isCurrent
                ? 'border-blue-500 bg-blue-50'
                : 'border-border hover:border-red-300 bg-background'
          )}
          onClick={() => onSelectCulpability(level.value)}
        >
          <div
            className={cn(
              'w-3 h-3 rounded-full shrink-0',
              isSelected ? 'bg-red-700' : isCurrent ? 'bg-blue-500' : 'bg-border'
            )}
          />
          <div className="flex-1">
            <span className="block text-sm font-semibold text-primary">
              {level.name}
              {isCurrent && !isSelected && (
                <span className="ml-2 text-xs font-normal text-blue-600">(current)</span>
              )}
            </span>
            <span className="block text-xs text-muted-foreground">{level.description}</span>
          </div>
        </button>
      );
    })}
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================

const DisputeForm: React.FC<DisputeFormProps> = ({
  severity,
  culpability,
  notes,
  onSelectSeverity,
  onSelectCulpability,
  onNotesChange,
  existingDispute,
  initiateRetractDispute,
  initiateModifyDispute,
  isSubmitting = false,
  initialModifying = false,
  existingVerification = null,
}) => {
  const [isModifying, setIsModifying] = useState(initialModifying);
  const [modifySeverity, setModifySeverity] = useState<DisputeSeverity | null>(null);
  const [modifyCulpability, setModifyCulpability] = useState<DisputeCulpability | null>(null);

  const handleStartModify = () => {
    setIsModifying(true);
    setModifySeverity(existingDispute?.severity || null);
    setModifyCulpability(existingDispute?.culpability || null);
  };

  const handleCancelModify = () => {
    setIsModifying(false);
    setModifySeverity(null);
    setModifyCulpability(null);
  };

  const handleConfirmModify = async () => {
    if (!existingDispute || modifySeverity === null || modifyCulpability === null) return;

    // Check if at least one value changed
    const severityChanged = modifySeverity !== existingDispute.severity;
    const culpabilityChanged = modifyCulpability !== existingDispute.culpability;

    if (!severityChanged && !culpabilityChanged) return;

    await initiateModifyDispute(existingDispute.recordHash, modifySeverity, modifyCulpability);
    setIsModifying(false);
    setModifySeverity(null);
    setModifyCulpability(null);
  };

  const handleRetract = async () => {
    if (!existingDispute) return;
    if (!confirm('Are you sure you want to retract your dispute?')) return;
    await initiateRetractDispute(existingDispute.recordHash);
  };

  // Helper to get display names
  const getSeverityName = (sev: DisputeSeverity) =>
    SEVERITY_OPTIONS.find(l => l.value === sev)?.name ?? sev;

  const getCulpabilityName = (culp: DisputeCulpability) =>
    CULPABILITY_OPTIONS.find(l => l.value === culp)?.name ?? culp;

  // ============================================================
  // MUTUAL EXCLUSIVITY CHECK
  // ============================================================

  if (existingVerification?.isActive) {
    return (
      <div className="text-center py-10">
        <div className="w-16 h-16 mx-auto mb-5 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
          <CheckCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-primary mb-2">
          You've already verified this record
        </h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
          You cannot dispute a record you have verified. To file a dispute, please retract your
          verification first from the Verify tab.
        </p>
      </div>
    );
  }

  // ============================================================
  // MODIFY VIEW
  // ============================================================

  if (isModifying && existingDispute) {
    const hasChanges =
      modifySeverity !== existingDispute.severity ||
      modifyCulpability !== existingDispute.culpability;

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-base font-semibold text-primary mb-1">Modify Dispute</h3>
          <p className="text-sm text-foreground mb-5">
            Current: <strong>{getSeverityName(existingDispute.severity)}</strong> severity,{' '}
            <strong>{getCulpabilityName(existingDispute.culpability)}</strong> culpability. Select
            new values below.
          </p>
        </div>

        {/* Severity Selection */}
        <div>
          <h4 className="text-sm font-semibold text-primary mb-3">Severity</h4>
          <SeveritySelector
            selectedSeverity={modifySeverity}
            onSelectSeverity={setModifySeverity}
            disabled={isSubmitting}
            currentSeverity={existingDispute.severity}
          />
        </div>

        {/* Culpability Selection */}
        <div>
          <h4 className="text-sm font-semibold text-primary mb-3">Culpability</h4>
          <CulpabilitySelector
            selectedCulpability={modifyCulpability}
            onSelectCulpability={setModifyCulpability}
            disabled={isSubmitting}
            currentCulpability={existingDispute.culpability}
          />
        </div>

        {/* Action Buttons */}
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
            disabled={
              isSubmitting || !modifySeverity || modifyCulpability === undefined || !hasChanges
            }
            className="flex-1 bg-red-600 hover:bg-red-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Updating...
              </>
            ) : (
              'Confirm Changes'
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // EXISTING DISPUTE VIEW
  // ============================================================

  if (existingDispute) {
    return (
      <div className="text-center py-10">
        <div className="w-16 h-16 mx-auto mb-5 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-primary mb-2">
          You've already disputed this record
        </h3>
        <p className="text-sm text-foreground mb-1">
          Severity: <strong>{getSeverityName(existingDispute.severity)}</strong>
        </p>
        <p className="text-sm text-foreground mb-6">
          Culpability: <strong>{getCulpabilityName(existingDispute.culpability)}</strong>
        </p>
        <div className="flex gap-3 justify-center">
          <Button
            variant="outline"
            className="border-red-600 text-red-600 hover:bg-red-50"
            onClick={handleStartModify}
            disabled={isSubmitting}
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Modify Dispute
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
  // NEW DISPUTE VIEW
  // ============================================================

  return (
    <div className="space-y-6">
      {/* Severity Selection */}
      <div>
        <h3 className="text-base font-semibold text-primary mb-3">How severe is the issue?</h3>
        <SeveritySelector
          selectedSeverity={severity}
          onSelectSeverity={onSelectSeverity}
          disabled={isSubmitting}
        />
      </div>

      {/* Culpability Selection */}
      <div>
        <h3 className="text-base font-semibold text-primary mb-3">What caused this issue?</h3>
        <CulpabilitySelector
          selectedCulpability={culpability}
          onSelectCulpability={onSelectCulpability}
          disabled={isSubmitting}
        />
      </div>

      {/* Notes Field */}
      <div>
        <h3 className="text-base font-semibold text-primary mb-1">Additional Details (Optional)</h3>
        <p className="text-sm text-foreground mb-3">
          Provide context about the issue. This will be encrypted and stored securely.
        </p>
        <textarea
          className={cn(
            'w-full p-4 text-sm border-2 border-border rounded-xl bg-background',
            'focus:outline-none focus:ring-2 focus:ring-red-700 focus:border-transparent',
            'placeholder-muted-foreground resize-y transition-all'
          )}
          placeholder="Describe the issue in detail..."
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          rows={3}
          disabled={isSubmitting}
        />
        <p className="mt-2 text-xs text-muted-foreground text-right">{notes.length} characters</p>
      </div>
    </div>
  );
};

export default DisputeForm;

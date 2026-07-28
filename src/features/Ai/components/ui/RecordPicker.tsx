// src/features/AIChat/components/RecordPicker.tsx

/**
 * RecordPicker
 *
 * Two exports:
 *
 *   RecordPickerContent  — pure UI (search + list + footer). No overlay.
 *                          Use this inside any existing modal or panel.
 *
 *   RecordPicker         — RecordPickerContent wrapped in a full-screen
 *                          overlay. Drop-in replacement for the original;
 *                          existing AI chat usage is unchanged.
 *
 * Props:
 *   records          — full list to pick from
 *   selectedRecordIds — controlled selection
 *   onSelectionChange — called with the new full selection on every toggle
 *   onClose          — called when Cancel or X is clicked
 *   actionLabel      — confirm button label (default: "Apply")
 *   disabledIds      — record IDs that render but cannot be toggled
 *                      (shown with a lock / "already added" state)
 *   disabledLabel    — text shown next to a disabled record (default: "Added")
 *   maxSelect        — cap on how many records can be selected at once
 *   variant          — 'default' (blue) | 'danger' (red confirm, for delete flows)
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check, X, FileText, Calendar, Lock } from 'lucide-react';
import { FileObject } from '@/types/core';

// ============================================================================
// TYPES
// ============================================================================

export interface RecordPickerProps {
  records: FileObject[];
  selectedRecordIds: string[];
  onSelectionChange: (recordIds: string[]) => void;
  onClose?: () => void;
  onApply?: (selectedIds: string[]) => void;
  actionLabel?: string;
  disabledIds?: string[];
  disabledLabel?: string;
  maxSelect?: number;
  variant?: 'default' | 'danger';
}

// ============================================================================
// RecordPickerContent — no overlay, fits inside any container
// ============================================================================

export function RecordPickerContent({
  records,
  selectedRecordIds,
  onSelectionChange,
  onApply,
  onClose,
  actionLabel = 'Apply',
  disabledIds = [],
  disabledLabel = 'Added',
  maxSelect,
  variant = 'default',
}: RecordPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [localSelection, setLocalSelection] = useState<Set<string>>(new Set(selectedRecordIds));

  // Sync if parent resets selectedRecordIds (e.g. after a batch action)
  useEffect(() => {
    setLocalSelection(new Set(selectedRecordIds));
  }, [selectedRecordIds.join(',')]);

  const filteredRecords = records.filter(record => {
    if (!searchQuery) return true; // no query → always show
    const q = searchQuery.toLowerCase();
    return (
      record.belroseFields?.title?.toLowerCase().includes(q) ||
      record.belroseFields?.provider?.toLowerCase().includes(q) ||
      record.belroseFields?.completedDate?.includes(q) ||
      record.fileName?.toLowerCase().includes(q)
    );
  });

  const toggle = (recordId: string) => {
    if (disabledIds.includes(recordId)) return;
    const next = new Set(localSelection);
    if (next.has(recordId)) {
      next.delete(recordId);
    } else {
      if (maxSelect && next.size >= maxSelect) return;
      next.add(recordId);
    }
    setLocalSelection(next);
    onSelectionChange(Array.from(next));
  };

  const clearAll = () => {
    setLocalSelection(new Set());
    onSelectionChange([]);
  };

  const handleApply = () => {
    const ids = Array.from(localSelection);
    onSelectionChange(ids);
    if (onApply) {
      onApply(ids);
    } else {
      onClose?.();
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const atMax = maxSelect ? localSelection.size >= maxSelect : false;

  const confirmBg =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-200'
      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300';

  const selectedBorder =
    variant === 'danger' ? 'border-red-500 bg-red-50' : 'border-blue-500 bg-blue-50';
  const selectedIconBg = variant === 'danger' ? 'bg-red-100' : 'bg-blue-100';
  const selectedCheckColor = variant === 'danger' ? 'text-red-600' : 'text-blue-600';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Select Records</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            {maxSelect
              ? `${localSelection.size} of ${maxSelect} selected`
              : `${localSelection.size} of ${records.length} selected`}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="p-4 border-b flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search records by title, provider, or date…"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
      </div>

      {/* Max-select notice */}
      {maxSelect && atMax && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          <p className="text-xs text-amber-700 font-medium">
            Maximum of {maxSelect} record{maxSelect !== 1 ? 's' : ''} reached. Deselect one to
            choose another.
          </p>
        </div>
      )}

      {/* Record list */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {filteredRecords.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              {searchQuery ? 'No records match your search' : 'No records available'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRecords.map(record => {
              const isSelected = localSelection.has(record.id);
              const isDisabled = disabledIds.includes(record.id);
              const isAtMaxAndUnselected = atMax && !isSelected;
              const title = record.belroseFields?.title || record.fileName || record.id;

              return (
                <button
                  key={record.id}
                  onClick={() => toggle(record.id)}
                  disabled={isDisabled || isAtMaxAndUnselected}
                  className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                    isDisabled
                      ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                      : isSelected
                        ? `${selectedBorder}`
                        : isAtMaxAndUnselected
                          ? 'border-gray-100 bg-white opacity-50 cursor-not-allowed'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-start items-center gap-3">
                    {/* Icon / check */}
                    <div
                      className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${
                        isDisabled ? 'bg-gray-100' : isSelected ? selectedIconBg : 'bg-gray-100'
                      }`}
                    >
                      {isDisabled ? (
                        <Lock className="w-4 h-4 text-gray-400" />
                      ) : isSelected ? (
                        <Check className={`w-4 h-4 ${selectedCheckColor}`} />
                      ) : (
                        <FileText className="w-4 h-4 text-gray-600" />
                      )}
                    </div>

                    {/* Record info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate text-sm">{title}</div>
                      <div className="flex items-center gap-2">
                        {record.belroseFields?.provider && (
                          <div className="text-sm text-gray-600 truncate">
                            {record.belroseFields.provider}
                          </div>
                        )}
                        {record.belroseFields?.completedDate && (
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Calendar className="w-3 h-3" />
                            {formatDate(record.belroseFields?.completedDate)}
                          </div>
                        )}
                      </div>
                      {record.belroseFields?.summary && (
                        <div className="text-xs text-gray-400 truncate">
                          {record.belroseFields.summary}
                        </div>
                      )}
                    </div>

                    {/* Disabled label */}
                    {isDisabled && (
                      <span className="text-xs text-gray-400 font-medium flex-shrink-0 self-center">
                        {disabledLabel}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
        <button
          onClick={clearAll}
          className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          Clear all
        </button>
        <div className="flex gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleApply}
            disabled={localSelection.size === 0}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:cursor-not-allowed ${confirmBg}`}
          >
            {actionLabel} ({localSelection.size})
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RecordPicker — RecordPickerContent wrapped in a full-screen overlay
// ============================================================================

export function RecordPicker(props: RecordPickerProps) {
  // Portaled to document.body — this is a full-screen overlay, so it can't be left to mount
  // wherever the caller happens to render it. A bare `<>...</>` fragment upstream (as in
  // GuestSharePanel/GuestFeatureGate) would otherwise make this `fixed` div a literal direct
  // child of whatever layout container hosts the caller, picking up unrelated spacing (e.g. a
  // parent's `space-y-*` margin) since Tailwind's sibling-margin selector doesn't know or care
  // that this div is meant to be a detached overlay.
  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
      onClick={props.onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <RecordPickerContent {...props} />
      </div>
    </div>,
    document.body
  );
}

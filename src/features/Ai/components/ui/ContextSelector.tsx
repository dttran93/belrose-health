// src/features/AIChat/components/ContextSelector.tsx

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, FileText, Users, FolderOpen, Settings } from 'lucide-react';
import { SubjectInfo, SubjectList } from './SubjectList';
import { RecordPicker } from './RecordPicker';
import { FileObject } from '@/types/core';
import { ContextSelection } from './ContextBadge';

interface ContextSelectorProps {
  currentUserId: string;
  availableSubjects: SubjectInfo[];
  allRecords: FileObject[];
  selectedContext: ContextSelection;
  onContextChange: (context: ContextSelection) => void;
  className?: string;
}

export function ContextSelector({
  currentUserId,
  availableSubjects,
  allRecords,
  selectedContext,
  onContextChange,
  className = '',
}: ContextSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showRecordPicker, setShowRecordPicker] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ✅ Determine if dropdown should open upward or downward
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = 400; // Approximate max height of dropdown
      const spaceBelow = window.innerHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;

      // Open upward if more space above or insufficient space below
      setOpenUpward(spaceBelow < dropdownHeight && spaceAbove > spaceBelow);
    }
  }, [isOpen]);

  const getContextLabel = () => {
    const count = selectedContext.recordCount;

    switch (selectedContext.type) {
      case 'my-records':
        return `My Records (${count})`;
      case 'subject':
        const subject = availableSubjects.find(s => s.id === selectedContext.subjectId);
        return `${subject?.name || 'Unknown'}'s Records (${count})`;
      case 'all-accessible':
        return `All Accessible Records (${count})`;
      case 'specific-records':
        return `Selected Records (${count})`;
      default:
        return 'Select Context';
    }
  };

  const handleSelectSubject = (subjectId: string, isMyRecords: boolean) => {
    // Filter records where subjects array includes this subjectId
    const records = allRecords.filter(r => r.subjects?.includes(subjectId));
    const subject = availableSubjects.find(s => s.id === subjectId);

    const recordIds = records.map(r => r.id);

    onContextChange({
      type: isMyRecords ? 'my-records' : 'subject',
      subjectId,
      recordIds,
      recordCount: records.length,
      description: isMyRecords
        ? `Your ${records.length} health records`
        : `${subject?.firstName || 'Their'}'s ${records.length} health records`,
    });
    setIsOpen(false);
  };

  const handleSelectAllAccessible = () => {
    const recordIds = allRecords.map(r => r.id);

    onContextChange({
      type: 'all-accessible',
      recordIds,
      recordCount: allRecords.length,
      description: `All ${allRecords.length} accessible records`,
    });
    setIsOpen(false);
  };

  const handleOpenRecordPicker = () => {
    setIsOpen(false);
    setShowRecordPicker(true);
  };

  const handleRecordSelectionChange = (recordIds: string[]) => {
    onContextChange({
      type: 'specific-records',
      recordIds,
      recordCount: recordIds.length,
      description: `${recordIds.length} selected records`,
    });
  };

  return (
    <>
      <div className={`relative ${className}`}>
        <button
          ref={buttonRef}
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
            isOpen ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <FileText className="w-4 h-4 text-gray-600" />
          <span className="text-xs font-medium text-gray-700">{getContextLabel()}</span>
          <ChevronDown
            className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

            {/* Dropdown Menu - positioned based on available space */}
            <div
              className={`absolute left-0 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden ${
                openUpward ? 'bottom-full mb-2' : 'top-full mt-2'
              }`}
            >
              <div className="p-3 border-b bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-900">Select Records Context</h3>
                <p className="text-xs text-gray-600 mt-0.5">
                  Choose which health records the AI should use
                </p>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {/* Subject List */}
                <div className="p-1">
                  <SubjectList
                    subjects={availableSubjects}
                    selectedSubjectId={
                      selectedContext.type === 'my-records' || selectedContext.type === 'subject'
                        ? selectedContext.subjectId || currentUserId
                        : null
                    }
                    currentUserId={currentUserId}
                    onSelectSubject={handleSelectSubject}
                  />
                </div>

                {/* Divider */}
                <div className="border-t border-gray-200" />

                {/* All Accessible Records */}
                <div className="px-1 pb-1">
                  <button
                    onClick={handleSelectAllAccessible}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors ${
                      selectedContext.type === 'all-accessible'
                        ? 'bg-green-50 border border-green-200'
                        : 'border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          selectedContext.type === 'all-accessible' ? 'bg-green-100' : 'bg-gray-100'
                        }`}
                      >
                        <Users
                          className={`w-4 h-4 ${
                            selectedContext.type === 'all-accessible'
                              ? 'text-green-600'
                              : 'text-gray-600'
                          }`}
                        />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium text-gray-900">
                          All Accessible Records
                        </div>
                        <div className="text-xs text-gray-500">
                          {allRecords.length} total records
                        </div>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-200" />

                {/* Specific Records Picker */}
                <div className="px-1 pb-1">
                  <button
                    onClick={handleOpenRecordPicker}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors ${
                      selectedContext.type === 'specific-records'
                        ? 'bg-orange-50 border border-orange-200'
                        : 'border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          selectedContext.type === 'specific-records'
                            ? 'bg-orange-100'
                            : 'bg-gray-100'
                        }`}
                      >
                        <FolderOpen
                          className={`w-4 h-4 ${
                            selectedContext.type === 'specific-records'
                              ? 'text-orange-600'
                              : 'text-gray-600'
                          }`}
                        />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium text-gray-900">
                          Choose Specific Records
                        </div>
                        <div className="text-xs text-gray-500">
                          {selectedContext.type === 'specific-records'
                            ? `${selectedContext.recordCount} selected`
                            : 'Pick individual records'}
                        </div>
                      </div>
                    </div>
                    <Settings className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Record Picker Modal */}
      {showRecordPicker && (
        <RecordPicker
          records={allRecords}
          selectedRecordIds={selectedContext.recordIds || []}
          onSelectionChange={handleRecordSelectionChange}
          onClose={() => setShowRecordPicker(false)}
        />
      )}
    </>
  );
}

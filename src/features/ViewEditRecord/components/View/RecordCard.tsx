import React from 'react';
import { Calendar, Edit, Eye, User, Hospital, Ellipsis, BriefcaseMedical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileObject } from '@/types/core';
import HealthRecordMenu from '@/features/ViewEditRecord/components/View/RecordMenu';
import { RecordIdentifiersPopover } from '@/features/ViewEditRecord/components/View/RecordIdentifiersPopover';
import { CredibilityBadge } from '@/features/Credibility/components/ui/CredibilityBadge';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import SubjectBadge from '@/features/Subject/components/SubjectBadge';
import FollowUpBadge from '@/features/RecordFollowUp/components/ui/FollowUpBadge';
import { useRecordFollowUps } from '@/features/RecordFollowUp/hooks/useRecordFollowUps';
import { useAuthContext } from '@/features/Auth/AuthContext';
import SubjectPermissionService from '@/features/Subject/services/subjectPermissionService';
import { PermissionsService } from '@/features/Permissions/services/permissionsService';

interface HealthRecordCardProps {
  record: FileObject;
  onView?: (record: FileObject) => void;
  onEdit?: (record: FileObject) => void;
  onVersions?: (record: FileObject) => void;
  onSubject?: (record: FileObject) => void;
  onAccess?: (record: FileObject) => void;
  onCredibility?: (record: FileObject) => void;
  onPermissions?: (record: FileObject) => void;
  onDownload?: (record: FileObject) => void;
  onCopy?: (record: FileObject) => void;
  onDelete?: (record: FileObject) => void;
  onFollowUp?: (record: FileObject) => void;
  className?: string;
}

export const getFileExtension = (fileName?: string): string => {
  if (!fileName) return 'Unknown';
  return fileName.split('.').pop()?.toUpperCase() || 'Unknown';
};

export const HealthRecordCard: React.FC<HealthRecordCardProps> = ({
  record,
  onView,
  onEdit,
  onSubject,
  onAccess,
  onVersions,
  onCredibility,
  onPermissions,
  onDownload,
  onCopy,
  onDelete,
  onFollowUp,
  className = '',
}) => {
  const displayName = record.fileName || 'Unknown Document';
  const { followUpItems, isLoading } = useRecordFollowUps(record);
  const { user } = useAuthContext();
  const canEditRecord = user ? PermissionsService.canManageRecord(record, user.uid) : false;

  return (
    <div
      className={`bg-background rounded-lg shadow-sm border border-border/20 hover:shadow-md transition-shadow ${className}`}
    >
      <div className="p-4 md:p-6">
        {/* Top bar */}

        <div className="flex items-center justify-between mb-2">
          {/* Left: type badges — belroseField/sourceType scrollable on mobile */}
          <div className="flex items-center justify-between gap-2">
            <RecordIdentifiersPopover record={record} />
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide min-w-0">
              <span className="flex-shrink-0 px-2 py-1 text-xs font-medium rounded-full border">
                {record.belroseFields?.visitType}
              </span>
              <span className="flex-shrink-0 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded border">
                {record.sourceType}
              </span>
            </div>
          </div>

          {/* Right: credibility + divider + menu — always visible, never scrolls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <FollowUpBadge
              followUpItems={followUpItems}
              isLoading={isLoading}
              onClick={() => onFollowUp?.(record)}
            />
            {/* SubjectBadge: hidden on mobile, shown md+ */}
            <div className="hidden md:flex items-center">
              <SubjectBadge record={record} onClick={() => onSubject?.(record)} />
            </div>
            <CredibilityBadge score={record.credibility?.score} />
            <HealthRecordMenu
              record={record}
              triggerIcon={Ellipsis}
              triggerClassName="p-2 rounded-3xl hover:bg-gray-100"
              onView={onView}
              showEdit={canEditRecord}
              onEdit={onEdit}
              onVersion={onVersions}
              onSubject={onSubject}
              onAccess={onAccess}
              onCredibility={onCredibility}
              onPermissions={onPermissions}
              onFollowUp={onFollowUp}
              onDownload={onDownload}
              onCopy={onCopy}
              onDelete={onDelete}
            />
          </div>
        </div>

        {/* Title */}
        <h3
          className="text-lg flex justify-start font-semibold text-gray-900 mb-2 line-clamp-2"
          title={displayName}
        >
          {record.belroseFields?.title}
        </h3>

        {/* Date */}
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
          <Calendar className="w-4 h-4 flex-shrink-0" />
          <span>{formatTimestamp(record.belroseFields?.completedDate, 'date-short')}</span>
        </div>

        {/* Provider / Institution */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <BriefcaseMedical className="w-4 h-4 flex-shrink-0" />
            <span>{record.belroseFields?.provider}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Hospital className="w-4 h-4 flex-shrink-0" />
            <span>{record.belroseFields?.institution || 'Institution not available'}</span>
          </div>
        </div>

        {/* Patient row — SubjectBadge inline on mobile only */}
        <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
          <User className="w-4 h-4 flex-shrink-0" />
          <span>{record.belroseFields?.patient}</span>
          {/* SubjectBadge sits here on mobile, hidden on md+ (shown in top bar instead) */}
          <div className="md:hidden ml-1">
            <SubjectBadge record={record} onOpenManager={() => onSubject?.(record)} />
          </div>
        </div>

        {/* Summary */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-2 text-left">
            Summary
          </p>
          <p className="text-left text-sm text-gray-700 line-clamp-2">
            {record.belroseFields?.summary}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <Button
            variant="default"
            onClick={() => onView?.(record)}
            className="flex-1 px-4 py-2 flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" />
            View
          </Button>
          <Button
            variant="outline"
            onClick={() => onEdit?.(record)}
            className="flex-1 px-4 py-2 flex items-center justify-center gap-2"
          >
            <Edit className="w-4 h-4" />
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HealthRecordCard;

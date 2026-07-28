//src/features/Subject/services/subjectPermissionService.ts

/*
 * This service manages checking permissions for subject service
 * - Can this user make a subject consent request (owner/admin only — uploadedBy is permanent
 *   audit metadata, not a live role, so it's deliberately not treated as automatic standing)
 * - Can this user remove a subject (owner only, if no owner then admin)
 */

import { PermissionsService } from '@/features/Permissions/services/permissionsService';
import { FileObject } from '@/types/core';

export class SubjectPermissionService {
  /**
   * Logic for cancelling a pending request
   */
  static canCancelRequest(record: FileObject, userId: string): boolean {
    // Current rule: same as manage, but kept separate for future restrictions
    return PermissionsService.canManageRecord(record, userId);
  }

  /**
   * Specific check: Can this user remove a subject?
   * Logic: Only owners can remove subjects, unless no owners exist,
   * in which case administrators can.
   */
  static canRemoveSubject(record: FileObject, userId: string): boolean {
    const isOwner = record.owners?.includes(userId);
    const isAdmin = record.administrators?.includes(userId);
    const hasOwners = record.owners && record.owners.length > 0;

    return isOwner || (isAdmin && !hasOwners);
  }
}

export default SubjectPermissionService;

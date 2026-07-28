// src/features/Permissions/services/__tests__/permissionEligibility.test.ts
//
// Starter unit tests — pure functions only, no Firestore/blockchain/emulators involved.
// getEligibleRoleTargets/canRevokeAccess take a plain record shape in and return a plain
// eligibility table out, so they can be tested by calling them directly with fixture data.

import { describe, it, expect } from 'vitest';
import { PermissionsService } from '../permissionsService';

const OWNER = 'owner-uid';
const OTHER_OWNER = 'other-owner-uid';
const ADMIN = 'admin-uid';
const OTHER_ADMIN = 'other-admin-uid';
const SHARER = 'sharer-uid';
const VIEWER = 'viewer-uid';

describe('PermissionsService.getEligibleRoleTargets', () => {
  it('lets a sharer see only "fully leave" as an option for their own access, not demote-to-viewer', () => {
    const record = { owners: [OWNER], administrators: [], sharers: [SHARER], viewers: [] };

    const eligibility = PermissionsService.getEligibleRoleTargets(record, SHARER, SHARER);

    // Demoting yourself to a different active tier is an owner/admin decision, not
    // something a plain sharer can do to themselves (matches firestore.rules BRANCH 6b).
    expect(eligibility.owner.enabled).toBe(false);
    expect(eligibility.administrator.enabled).toBe(false);
    expect(eligibility.sharer.enabled).toBe(false);
    expect(eligibility.viewer.enabled).toBe(false);
  });

  it('lets an owner change their own access, but blocks anyone else from touching it', () => {
    const record = { owners: [OWNER, OTHER_OWNER], administrators: [], sharers: [], viewers: [] };

    const ownActions = PermissionsService.getEligibleRoleTargets(record, OWNER, OWNER);
    expect(ownActions.administrator.enabled).toBe(true);
    expect(ownActions.sharer.enabled).toBe(true);
    expect(ownActions.viewer.enabled).toBe(true);

    const otherOwnerActingOnFirstOwner = PermissionsService.getEligibleRoleTargets(
      record,
      OTHER_OWNER,
      OWNER
    );
    expect(otherOwnerActingOnFirstOwner.administrator.enabled).toBe(false);
    expect(otherOwnerActingOnFirstOwner.sharer.enabled).toBe(false);
    expect(otherOwnerActingOnFirstOwner.viewer.enabled).toBe(false);
  });

  it('blocks an admin from demoting another admin while an owner exists, but allows it once no owner exists', () => {
    const withOwner = {
      owners: [OWNER],
      administrators: [ADMIN, OTHER_ADMIN],
      sharers: [],
      viewers: [],
    };
    const blocked = PermissionsService.getEligibleRoleTargets(withOwner, ADMIN, OTHER_ADMIN);
    expect(blocked.sharer.enabled).toBe(false);
    expect(blocked.viewer.enabled).toBe(false);

    const noOwner = { owners: [], administrators: [ADMIN, OTHER_ADMIN], sharers: [], viewers: [] };
    const allowed = PermissionsService.getEligibleRoleTargets(noOwner, ADMIN, OTHER_ADMIN);
    expect(allowed.sharer.enabled).toBe(true);
    expect(allowed.viewer.enabled).toBe(true);
  });

  it('only lets an admin promote someone to owner when no owner exists yet', () => {
    const noOwner = { owners: [], administrators: [ADMIN], sharers: [], viewers: [VIEWER] };
    expect(PermissionsService.getEligibleRoleTargets(noOwner, ADMIN, VIEWER).owner.enabled).toBe(
      true
    );

    const hasOwner = { owners: [OWNER], administrators: [ADMIN], sharers: [], viewers: [VIEWER] };
    expect(PermissionsService.getEligibleRoleTargets(hasOwner, ADMIN, VIEWER).owner.enabled).toBe(
      false
    );
  });

  it('blocks demoting an active subject below sharer', () => {
    const record = {
      owners: [OWNER],
      administrators: [],
      sharers: [SHARER],
      viewers: [],
      subjects: [SHARER],
    };

    const eligibility = PermissionsService.getEligibleRoleTargets(record, OWNER, SHARER);

    expect(eligibility.viewer.enabled).toBe(false);
  });
});

describe('PermissionsService.canRevokeAccess', () => {
  it('always allows self-removal, even for a plain sharer with no other role', () => {
    const record = { owners: [OWNER], administrators: [], sharers: [SHARER], viewers: [] };

    expect(PermissionsService.canRevokeAccess(record, SHARER, SHARER).enabled).toBe(true);
  });

  it('blocks removing a different owner, but allows an owner to remove themselves', () => {
    const record = { owners: [OWNER, OTHER_OWNER], administrators: [], sharers: [], viewers: [] };

    expect(PermissionsService.canRevokeAccess(record, OTHER_OWNER, OWNER).enabled).toBe(false);
    expect(PermissionsService.canRevokeAccess(record, OWNER, OWNER).enabled).toBe(true);
  });

  it('blocks removing the sole owner when no administrators exist', () => {
    const record = { owners: [OWNER], administrators: [], sharers: [], viewers: [] };

    expect(PermissionsService.canRevokeAccess(record, OWNER, OWNER).enabled).toBe(false);
  });

  it('blocks fully revoking an active subject regardless of caller', () => {
    const record = {
      owners: [OWNER],
      administrators: [],
      sharers: [SHARER],
      viewers: [],
      subjects: [SHARER],
    };

    expect(PermissionsService.canRevokeAccess(record, OWNER, SHARER).enabled).toBe(false);
  });
});

describe('PermissionsService.canManageRecord', () => {
  const UPLOADER = 'uploader-uid';
  const STRANGER = 'stranger-uid';

  function makeRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'record1',
      uploadedBy: UPLOADER,
      owners: [OWNER],
      administrators: [ADMIN],
      ...overrides,
    };
  }

  it('denies a plain uploader who is neither owner nor administrator', () => {
    // uploadedBy is permanent audit metadata, not a live role — same reasoning as
    // useSubjectFlow.getUserRoleForRecord's removed uploader fallback. An uploader who wants
    // guaranteed standing can always make themselves owner.
    expect(PermissionsService.canManageRecord(makeRecord() as any, UPLOADER)).toBe(false);
  });

  it('allows an owner', () => {
    expect(PermissionsService.canManageRecord(makeRecord() as any, OWNER)).toBe(true);
  });

  it('allows an administrator', () => {
    expect(PermissionsService.canManageRecord(makeRecord() as any, ADMIN)).toBe(true);
  });

  it('denies a stranger with no relationship to the record', () => {
    expect(PermissionsService.canManageRecord(makeRecord() as any, STRANGER)).toBe(false);
  });

  it('handles missing owners/administrators arrays without throwing', () => {
    const record = makeRecord({ owners: undefined, administrators: [] });
    expect(PermissionsService.canManageRecord(record as any, STRANGER)).toBe(false);
  });

  it('denies a sharer — canManageRecord only recognizes uploader/owner/administrator', () => {
    const record = makeRecord({ sharers: [SHARER] });
    expect(PermissionsService.canManageRecord(record as any, SHARER)).toBe(false);
  });

  it('denies a viewer — canManageRecord only recognizes uploader/owner/administrator', () => {
    const record = makeRecord({ viewers: [VIEWER] });
    expect(PermissionsService.canManageRecord(record as any, VIEWER)).toBe(false);
  });
});

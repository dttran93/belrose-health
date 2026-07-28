// src/features/Subject/services/__tests__/subjectPermissionService.test.ts
//
// Tier 1 — pure functions, no Firestore/mocking involved.

import { describe, it, expect } from 'vitest';
import { SubjectPermissionService } from '../subjectPermissionService';
import type { FileObject } from '@/types/core';

const UPLOADER = 'uploader-uid';
const OWNER = 'owner-uid';
const ADMIN = 'admin-uid';
const STRANGER = 'stranger-uid';

function makeRecord(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 'record1',
    uploadedBy: UPLOADER,
    owners: [OWNER],
    administrators: [ADMIN],
    ...overrides,
  } as unknown as FileObject;
}

describe('SubjectPermissionService.canCancelRequest', () => {
  it('mirrors canManageRecord (currently the same rule, kept separate for future restrictions)', () => {
    const record = makeRecord();
    expect(SubjectPermissionService.canCancelRequest(record, OWNER)).toBe(true);
    expect(SubjectPermissionService.canCancelRequest(record, UPLOADER)).toBe(false);
    expect(SubjectPermissionService.canCancelRequest(record, STRANGER)).toBe(false);
  });
});

describe('SubjectPermissionService.canRemoveSubject', () => {
  it('allows an owner even when administrators also exist', () => {
    expect(SubjectPermissionService.canRemoveSubject(makeRecord(), OWNER)).toBe(true);
  });

  it('denies an administrator while an owner still exists', () => {
    expect(SubjectPermissionService.canRemoveSubject(makeRecord(), ADMIN)).toBe(false);
  });

  it('allows an administrator once there are no owners at all', () => {
    const record = makeRecord({ owners: [] });
    expect(SubjectPermissionService.canRemoveSubject(record, ADMIN)).toBe(true);
  });

  it('denies a stranger regardless of owner state', () => {
    expect(SubjectPermissionService.canRemoveSubject(makeRecord({ owners: [] }), STRANGER)).toBe(false);
  });

  it('denies the uploader when they are neither owner nor administrator', () => {
    const record = makeRecord({ owners: [OWNER], administrators: [ADMIN], uploadedBy: UPLOADER });
    expect(SubjectPermissionService.canRemoveSubject(record, UPLOADER)).toBe(false);
  });

  it('denies a sharer, even with no owners — canRemoveSubject only recognizes owner/administrator', () => {
    const record = makeRecord({ owners: [], sharers: ['sharer-uid'] } as any);
    expect(SubjectPermissionService.canRemoveSubject(record, 'sharer-uid')).toBe(false);
  });

  it('denies a viewer, even with no owners — canRemoveSubject only recognizes owner/administrator', () => {
    const record = makeRecord({ owners: [], viewers: ['viewer-uid'] } as any);
    expect(SubjectPermissionService.canRemoveSubject(record, 'viewer-uid')).toBe(false);
  });
});

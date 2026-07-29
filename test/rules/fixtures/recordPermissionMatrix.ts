// test/rules/fixtures/recordPermissionMatrix.ts
//
// Fixture data for the records/{recordId} `allow update` branches that are relevant to the
// Permissions feature (BRANCH 1: admin/owner; BRANCH 5: sharer granting viewer; BRANCH 6:
// viewer self-removal; BRANCH 6b: sharer self-removal). See firestore.rules for the source
// of truth these fixtures are transcribed from.

export interface RoleArrays {
  owners: string[];
  administrators: string[];
  sharers: string[];
  viewers: string[];
  subjects: string[];
}

export interface RecordPermissionCase {
  /** Also used as the seeded recordId, so keep it unique and descriptive. */
  name: string;
  /** Seeded starting state. */
  before: RoleArrays;
  /** The write being attempted — merged over `before`. */
  after: Partial<RoleArrays>;
  callerId: string;
  expected: 'allow' | 'deny';
}

export const OWNER = 'owner-uid';
export const OWNER_2 = 'owner2-uid';
export const ADMIN = 'admin-uid';
export const ADMIN_2 = 'admin2-uid';
export const SHARER = 'sharer-uid';
export const VIEWER = 'viewer-uid';
export const NEW_USER = 'new-user-uid';

export function baseRecord(overrides: Partial<RoleArrays> = {}): RoleArrays & { uploadedBy: string } {
  // uploadedBy is always set on real records (upload provenance metadata) — included here to
  // match reality, but it is NOT read by any rule helper for access purposes: uploader access is
  // only granted via the role arrays (createFirestoreRecord adds the uploader to administrators
  // by default), so a removed/demoted uploader correctly loses access.
  return {
    owners: [],
    administrators: [],
    sharers: [],
    viewers: [],
    subjects: [],
    uploadedBy: 'uploader-uid',
    ...overrides,
  };
}

// ============================================================================
// BRANCH 1 — admin/owner updating the record
// ============================================================================

export const adminOwnerCases: RecordPermissionCase[] = [
  {
    name: 'admin-grants-viewer-allowed',
    before: baseRecord({ owners: [OWNER], administrators: [ADMIN] }),
    after: { viewers: [NEW_USER] },
    callerId: ADMIN,
    expected: 'allow',
  },
  {
    name: 'admin-bootstraps-first-owner-allowed',
    before: baseRecord({ administrators: [ADMIN] }),
    after: { owners: [OWNER] },
    callerId: ADMIN,
    expected: 'allow',
  },
  {
    name: 'admin-cannot-add-owner-once-one-already-exists',
    before: baseRecord({ owners: [OWNER], administrators: [ADMIN] }),
    after: { owners: [OWNER, OWNER_2] },
    callerId: ADMIN,
    expected: 'deny',
  },
  {
    name: 'admin-self-removal-allowed-even-with-owner-present',
    before: baseRecord({ owners: [OWNER], administrators: [ADMIN] }),
    after: { administrators: [] },
    callerId: ADMIN,
    expected: 'allow',
  },
  {
    name: 'admin-cannot-remove-a-different-admin-while-owner-exists',
    before: baseRecord({ owners: [OWNER], administrators: [ADMIN, ADMIN_2] }),
    after: { administrators: [ADMIN] },
    callerId: ADMIN,
    expected: 'deny',
  },
  {
    name: 'admin-can-remove-a-different-admin-once-no-owner-exists',
    before: baseRecord({ owners: [], administrators: [ADMIN, ADMIN_2] }),
    after: { administrators: [ADMIN] },
    callerId: ADMIN,
    expected: 'allow',
  },
  {
    name: 'last-administrator-cannot-remove-themselves-with-no-owner',
    before: baseRecord({ owners: [], administrators: [ADMIN] }),
    after: { administrators: [] },
    callerId: ADMIN,
    expected: 'deny',
  },
  {
    name: 'admin-cannot-sneak-a-subjects-change-into-this-branch',
    before: baseRecord({ owners: [OWNER], administrators: [ADMIN] }),
    after: { viewers: [NEW_USER], subjects: [NEW_USER] },
    callerId: ADMIN,
    expected: 'deny',
  },
];

// ============================================================================
// BRANCH 5/6/6b — sharer granting viewer, viewer self-removal, sharer self-removal
// ============================================================================

export const sharerViewerSelfServiceCases: RecordPermissionCase[] = [
  {
    name: 'sharer-grants-viewer-allowed',
    before: baseRecord({ owners: [OWNER], sharers: [SHARER] }),
    after: { viewers: [NEW_USER] },
    callerId: SHARER,
    expected: 'allow',
  },
  {
    name: 'sharer-cannot-touch-sharers-array-in-the-viewer-grant-branch',
    before: baseRecord({ owners: [OWNER], sharers: [SHARER] }),
    after: { viewers: [NEW_USER], sharers: [SHARER, NEW_USER] },
    callerId: SHARER,
    expected: 'deny',
  },
  {
    name: 'viewer-removes-self-allowed',
    before: baseRecord({ owners: [OWNER], viewers: [VIEWER] }),
    after: { viewers: [] },
    callerId: VIEWER,
    expected: 'allow',
  },
  {
    name: 'sharer-leaves-entirely-allowed',
    before: baseRecord({ owners: [OWNER], sharers: [SHARER] }),
    after: { sharers: [] },
    callerId: SHARER,
    expected: 'allow',
  },
  {
    // Regression fixture: the JS-level check in removeSharer used to allow a plain sharer
    // to demote themselves straight to viewer. firestore.rules never allowed it — self-service
    // can only fully leave a role, not renegotiate to a lesser tier. See BRANCH 6b.
    name: 'sharer-demotes-self-to-viewer-denied',
    before: baseRecord({ owners: [OWNER], sharers: [SHARER] }),
    after: { sharers: [], viewers: [SHARER] },
    callerId: SHARER,
    expected: 'deny',
  },
];

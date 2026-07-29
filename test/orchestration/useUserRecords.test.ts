// @vitest-environment jsdom
//
// test/orchestration/useUserRecords.test.ts
//
// Layer 3 (orchestration) — useUserRecords, the real-time records listener every records list
// view is built on. Real Firestore emulator (useUserRecords calls getFirestore() with no app
// argument, same as PermissionsService, so connectTestFirestore's default-app swap just works —
// no config mock needed, and this hook doesn't touch firebase/auth at all). Real
// EncryptionKeyManager/RecordDecryptionService for the decrypt-on-load branch. jsdom is needed
// here (unlike the other orchestration files) because this is an actual React hook rendered via
// renderHook, not a plain service class.
//
// Covers the per-filterType query branching and, most importantly, the client-side
// "verify access before applying subject filter" security check: the initial Firestore query for
// someone else's subject-filtered records is deliberately broad (includes sharers), but the
// hook re-checks access with a narrower set (excluding sharers) before returning results.
//
// Each test uses its own unique userId/record-id namespace rather than relying on
// clearTestFirestore() for isolation: onSnapshot's local watch cache doesn't reliably observe
// clearTestFirestore's out-of-band REST wipe between tests (unlike the one-shot getDoc/getDocs
// reads every other orchestration file uses), so a prior test's documents can still surface in a
// later listener. Scoping every query to a userId no other test touches sidesteps that
// entirely, regardless of the underlying cache behavior.

import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { useUserRecords } from '../../src/features/ViewEditRecord/hooks/useUserRecords';
import { EncryptionKeyManager } from '../../src/features/Encryption/services/encryptionKeyManager';

const db = connectTestFirestore('belrose-orchestration-user-records');

function installFakeSessionStorage() {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal('sessionStorage', fakeStorage);
}

interface SeedRoles {
  uploadedBy?: string;
  owners?: string[];
  administrators?: string[];
  sharers?: string[];
  viewers?: string[];
  subjects?: string[];
}

async function seedPlainRecord(recordId: string, roles: SeedRoles, overrides: Record<string, unknown> = {}) {
  await setDoc(doc(db, 'records', recordId), {
    fileName: `${recordId}.pdf`,
    fileSize: 100,
    fileType: 'application/pdf',
    isEncrypted: false,
    uploadedBy: roles.uploadedBy,
    owners: roles.owners ?? [],
    administrators: roles.administrators ?? [],
    sharers: roles.sharers ?? [],
    viewers: roles.viewers ?? [],
    subjects: roles.subjects ?? [],
    uploadedAt: Timestamp.now(),
    ...overrides,
  });
}

beforeEach(async () => {
  await clearTestFirestore();
  installFakeSessionStorage();
  EncryptionKeyManager.clearSession();
});

afterEach(() => {
  // vitest.orchestration.config.ts has no setupFiles, so RTL's usual automatic afterEach
  // cleanup never runs — without this, useUserRecords' onSnapshot listener from a prior test
  // stays subscribed longer than intended.
  cleanup();
});

afterAll(() => {
  getApps().forEach(app => deleteApp(app));
});

describe('useUserRecords — no userId', () => {
  it('returns an empty, non-loading result when userId is undefined', async () => {
    const { result } = renderHook(() => useUserRecords(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records).toEqual([]);
  });
});

describe('useUserRecords — filterType "uploaded"', () => {
  it('returns only records the user uploaded themselves', async () => {
    const ME = 'user-uploaded-test';
    await seedPlainRecord('r-uploaded-by-me', { uploadedBy: ME });
    await seedPlainRecord('r-uploaded-by-other-1', { uploadedBy: 'other-1', viewers: [ME] });

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'uploaded' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records.map(r => r.id)).toEqual(['r-uploaded-by-me']);
  });
});

describe('useUserRecords — filterType "owner"', () => {
  it('returns only records where the user is an owner', async () => {
    const ME = 'user-owner-test';
    await seedPlainRecord('r-owned-1', { uploadedBy: 'other-2', owners: [ME] });
    await seedPlainRecord('r-administered-only-1', { uploadedBy: 'other-2', administrators: [ME] });

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'owner' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records.map(r => r.id)).toEqual(['r-owned-1']);
  });
});

describe('useUserRecords — filterType "all"', () => {
  it('returns records reachable via any role (owner/admin/sharer/viewer/subject)', async () => {
    const ME = 'user-all-test';
    await seedPlainRecord('r-all-owner', { uploadedBy: 'other-3', owners: [ME] });
    await seedPlainRecord('r-all-admin', { uploadedBy: 'other-3', administrators: [ME] });
    await seedPlainRecord('r-all-sharer', { uploadedBy: 'other-3', sharers: [ME] });
    await seedPlainRecord('r-all-viewer', { uploadedBy: 'other-3', viewers: [ME] });
    await seedPlainRecord('r-all-subject', { uploadedBy: 'other-3', subjects: [ME] });
    await seedPlainRecord('r-all-unrelated', { uploadedBy: 'other-3' });

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(new Set(result.current.records.map(r => r.id))).toEqual(
      new Set([
        'r-all-owner',
        'r-all-admin',
        'r-all-sharer',
        'r-all-viewer',
        'r-all-subject',
      ])
    );
  });

  it('excludes a record the user only uploaded but holds no role on (e.g. removed as admin afterward)', async () => {
    const ME = 'user-all-former-uploader-test';
    await seedPlainRecord('r-all-uploaded-no-role', { uploadedBy: ME });

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toHaveLength(0);
  });
});

describe('useUserRecords — filterType "subject"', () => {
  it('defaults to the current user as the subject when no subjectId is given', async () => {
    const ME = 'user-subject-self-test';
    await seedPlainRecord('r-self-subject-1', { uploadedBy: 'other-4', subjects: [ME] });
    await seedPlainRecord('r-not-subject-1', { uploadedBy: 'other-4', viewers: [ME] });

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'subject' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records.map(r => r.id)).toEqual(['r-self-subject-1']);
  });

  it('excludes a record from another-subject view when the caller only has sharer access (client-side security check)', async () => {
    // Caller is a sharer (not owner/admin/viewer/uploader) on a record whose subject is a third
    // party. The initial Firestore query is broad (includes sharers), but the hook's
    // client-side re-check deliberately excludes sharer-only access before applying the subject
    // filter — this record must not leak through.
    const ME = 'user-subject-security-test';
    const PATIENT = 'patient-security-test';
    await seedPlainRecord('r-sharer-only-1', {
      uploadedBy: 'other-5',
      sharers: [ME],
      subjects: [PATIENT],
    });
    // Control: caller IS a viewer (allowed tier) on a record with the same subject.
    await seedPlainRecord('r-viewer-allowed-1', {
      uploadedBy: 'other-5',
      viewers: [ME],
      subjects: [PATIENT],
    });

    const { result } = renderHook(() =>
      useUserRecords(ME, { filterType: 'subject', subjectId: PATIENT })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records.map(r => r.id)).toEqual(['r-viewer-allowed-1']);
  });
});

describe('useUserRecords — decryption', () => {
  it('passes through encrypted records with a warning when there is no active encryption session', async () => {
    const ME = 'user-decrypt-nosession-test';
    await seedPlainRecord(
      'r-encrypted-no-session-1',
      { uploadedBy: ME },
      { isEncrypted: true, encryptedFileName: { encrypted: 'ciphertext', iv: 'iv' } }
    );

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'uploaded' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0]?.isEncrypted).toBe(true);
  });

  it('does not attempt decryption at all when no records are encrypted', async () => {
    const ME = 'user-decrypt-none-test';
    await seedPlainRecord('r-plain-1', { uploadedBy: ME });

    const { result } = renderHook(() => useUserRecords(ME, { filterType: 'uploaded' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });
});

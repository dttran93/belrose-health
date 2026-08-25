// @vitest-environment jsdom
//
// src/features/Auth/services/__tests__/authServices.test.ts
//
// Tier 3 (firebase/auth + UserService mocked at the module boundary) unit tests for
// authService. jsdom is needed because signUp/resendVerificationEmail read
// window.location.origin directly. UserService.createUserDocument is mocked here (it
// has its own dedicated test file) so these tests only assert authService's own
// call-wiring — in particular that every sign-in path (email, Google, Facebook,
// GitHub) calls createUserDocument as its "ensure a Firestore profile exists" safety
// net, per the header comments in authServices.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthState,
  createUserWithEmailAndPasswordMock,
  signInWithEmailAndPasswordMock,
  signInWithPopupMock,
  sendEmailVerificationMock,
  sendPasswordResetEmailMock,
  updateProfileMock,
  createUserDocumentMock,
} = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as any },
  createUserWithEmailAndPasswordMock: vi.fn(),
  signInWithEmailAndPasswordMock: vi.fn(),
  signInWithPopupMock: vi.fn(),
  sendEmailVerificationMock: vi.fn(async () => undefined),
  sendPasswordResetEmailMock: vi.fn(async () => undefined),
  updateProfileMock: vi.fn(async () => undefined),
  createUserDocumentMock: vi.fn(async () => undefined),
}));

vi.mock('../../../../firebase/config', () => ({ auth: mockAuthState }));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: createUserWithEmailAndPasswordMock,
  signInWithEmailAndPassword: signInWithEmailAndPasswordMock,
  signInWithPopup: signInWithPopupMock,
  signOut: vi.fn(async () => undefined),
  sendPasswordResetEmail: sendPasswordResetEmailMock,
  sendEmailVerification: sendEmailVerificationMock,
  updateProfile: updateProfileMock,
  onAuthStateChanged: vi.fn(() => () => {}),
  FacebookAuthProvider: vi.fn(),
  GithubAuthProvider: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

vi.mock('../userService', () => ({
  UserService: {
    createUserDocument: createUserDocumentMock,
    updateUserProfile: vi.fn(async () => undefined),
  },
}));

import { authService } from '../authServices';

function fakeUser(overrides: Record<string, unknown> = {}) {
  return { uid: 'uid-1', email: 'user@example.com', emailVerified: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthState.currentUser = null;
});

describe('authService.signUp', () => {
  it('creates the auth user, sets displayName, creates the Firestore doc, and sends verification email', async () => {
    const user = fakeUser();
    createUserWithEmailAndPasswordMock.mockResolvedValue({ user });

    const result = await authService.signUp('user@example.com', 'password123', 'Jane Doe');

    expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(
      mockAuthState,
      'user@example.com',
      'password123'
    );
    expect(updateProfileMock).toHaveBeenCalledWith(user, { displayName: 'Jane Doe' });
    expect(createUserDocumentMock).toHaveBeenCalledWith(user);
    expect(sendEmailVerificationMock).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ handleCodeInApp: false })
    );
    expect(result).toBe(user);
  });

  it('skips updateProfile when no displayName is given', async () => {
    const user = fakeUser();
    createUserWithEmailAndPasswordMock.mockResolvedValue({ user });

    await authService.signUp('user@example.com', 'password123');

    expect(updateProfileMock).not.toHaveBeenCalled();
    expect(createUserDocumentMock).toHaveBeenCalledWith(user);
  });

  it('propagates errors from createUserWithEmailAndPassword', async () => {
    createUserWithEmailAndPasswordMock.mockRejectedValue(
      Object.assign(new Error('exists'), { code: 'auth/email-already-in-use' })
    );

    await expect(authService.signUp('user@example.com', 'password123')).rejects.toThrow('exists');
    expect(createUserDocumentMock).not.toHaveBeenCalled();
  });
});

describe('authService.signIn', () => {
  it('signs in and re-runs createUserDocument as a safety net', async () => {
    const user = fakeUser();
    signInWithEmailAndPasswordMock.mockResolvedValue({ user });

    const result = await authService.signIn('user@example.com', 'password123');

    expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(
      mockAuthState,
      'user@example.com',
      'password123'
    );
    expect(createUserDocumentMock).toHaveBeenCalledWith(user);
    expect(result).toBe(user);
  });
});

describe('authService.resendVerificationEmail', () => {
  it('throws when no user is signed in', async () => {
    mockAuthState.currentUser = null;
    await expect(authService.resendVerificationEmail()).rejects.toThrow(
      'No user is currently signed in'
    );
  });

  it('throws when the email is already verified', async () => {
    mockAuthState.currentUser = fakeUser({ emailVerified: true });
    await expect(authService.resendVerificationEmail()).rejects.toThrow(
      'Email is already verified'
    );
  });

  it('sends the verification email when unverified', async () => {
    const user = fakeUser({ emailVerified: false });
    mockAuthState.currentUser = user;

    await authService.resendVerificationEmail();

    expect(sendEmailVerificationMock).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ handleCodeInApp: false })
    );
  });
});

describe('authService.resetPassword', () => {
  it('calls sendPasswordResetEmail with the given email', async () => {
    await authService.resetPassword('user@example.com');
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(mockAuthState, 'user@example.com');
  });

  it('propagates errors', async () => {
    sendPasswordResetEmailMock.mockRejectedValueOnce(new Error('bad email'));
    await expect(authService.resetPassword('bad')).rejects.toThrow('bad email');
  });
});

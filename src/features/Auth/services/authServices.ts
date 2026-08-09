// src/services/authService.ts
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  User,
  UserCredential,
  Unsubscribe,
} from 'firebase/auth';
import { auth } from '../../../firebase/config';
import { UserService } from './userService';

export interface AuthError {
  code: string;
  message: string;
}

export const authService = {
  /**
   * Sign up with email and password
   */
  signUp: async (email: string, password: string, displayName?: string): Promise<User> => {
    try {
      const userCredential: UserCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      if (displayName) {
        await updateProfile(userCredential.user, { displayName });
      }

      // Create Firestore user document
      await UserService.createUserDocument(userCredential.user);

      // Send verification email
      await sendEmailVerification(userCredential.user, {
        url: window.location.origin + '/verify-email', // Redirect URL after verification
        handleCodeInApp: false,
      });

      console.log('✅ Verification email sent to:', email);

      console.log('User registered and profile created successfully');
      return userCredential.user;
    } catch (error) {
      console.error('Sign up failed:', error);
      throw error;
    }
  },

  /**
   * Resend verification email
   */
  resendVerificationEmail: async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No user is currently signed in');
    }

    if (user.emailVerified) {
      throw new Error('Email is already verified');
    }

    try {
      await sendEmailVerification(user, {
        url: window.location.origin + '/verify-email',
        handleCodeInApp: false,
      });
      console.log('✅ Verification email resent');
    } catch (error) {
      console.error('Failed to resend verification email:', error);
      throw error;
    }
  },

  /**
   * Check if current user's email is verified
   */
  isEmailVerified: (): boolean => {
    const user = auth.currentUser;
    return user?.emailVerified || false;
  },

  /**
   * Reload user to get latest emailVerified status
   */
  reloadUser: async (): Promise<void> => {
    const user = auth.currentUser;
    if (user) {
      await user.reload();
    }
  },

  /**
   * Sign in with email and password
   */
  signIn: async (email: string, password: string): Promise<User> => {
    try {
      const userCredential: UserCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      // Ensure user document exists (safety net for existing users)
      await UserService.createUserDocument(userCredential.user);

      return userCredential.user;
    } catch (error) {
      console.error('Sign in failed:', error);
      throw error;
    }
  },

  /**
   * Get current authenticated user
   */
  getCurrentUser: (): User | null => {
    return auth.currentUser;
  },

  /**
   * Listen for auth state changes
   */
  onAuthStateChanged: (callback: (user: User | null) => void): Unsubscribe => {
    return onAuthStateChanged(auth, callback);
  },

  /**
   * Sign out method
   */
  signOut: async (): Promise<void> => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign out failed:', error);
      throw error;
    }
  },

  /**
   * Reset password
   */
  resetPassword: async (email: string): Promise<void> => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      console.error('Password reset failed:', error);
      throw error;
    }
  },

  /**
   * Get user token for API calls
   */
  getToken: async (): Promise<string | null> => {
    const user = auth.currentUser;
    if (user) {
      try {
        return await user.getIdToken();
      } catch (error) {
        console.error('Failed to get token:', error);
        return null;
      }
    }
    return null;
  },

  /**
   * Update user profile
   */
  updateUserProfile: async (updates: {
    displayName?: string;
    photoURL?: string;
  }): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No user is currently signed in');
    }

    try {
      await updateProfile(user, updates);

      // Also update Firestore document
      if (updates.displayName) {
        await UserService.updateUserProfile(user.uid, {
          displayName: updates.displayName,
        });
      }
    } catch (error) {
      console.error('Profile update failed:', error);
      throw error;
    }
  },

  /**
   * Check if user is signed in
   */
  isSignedIn: (): boolean => {
    return !!auth.currentUser;
  },

  /**
   * Get user ID
   */
  getCurrentUserId: (): string | null => {
    return auth.currentUser?.uid || null;
  },

  /**
   * Get user email
   */
  getCurrentUserEmail: (): string | null => {
    return auth.currentUser?.email || null;
  },

  /**
   * Wait for auth to initialize
   */
  waitForAuth: (): Promise<User | null> => {
    return new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        unsubscribe();
        resolve(user);
      });
    });
  },
};

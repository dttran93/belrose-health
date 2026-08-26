/**
 * Messaging feature — public exports
 *
 * Import from here, never from internal paths directly.
 * This keeps the crypto and Firestore layers encapsulated and swappable.
 */

// Primary hook — what components use
export { useMessaging } from './hooks/useMessaging';
export type { UseMessagingReturn, DecryptedMessage } from './hooks/useMessaging';

// Service types — needed by components that display conversation lists
export type { Conversation, StoredMessage } from './services/messageService';

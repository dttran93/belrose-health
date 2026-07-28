// src/pages/AIHealthAssistantView.tsx

/**
 * Component for rendering the AI Assistant View. Main entry point for AI Chat Feature.
 * Handles different states (loading, error, no records) and renders the main AIChat component when data is ready.
 * Also toggles between no message view and chat view based on whether there are messages in the current chat.
 */

import { MessageSquare, Sparkles, Shield, X, Loader2 } from 'lucide-react';
import { AIChat } from '@/features/Ai/components/AIChat';
import { FileObject } from '@/types/core';
import { SubjectInfo } from '@/features/Ai/components/ui/SubjectList';
import { ContextSelection } from '@/features/Ai/components/ui/ContextBadge';
import { ContextSelector } from '@/features/Ai/components/ui/ContextSelector';
import { Message } from '../service/chatService';
import { ChatAttachment } from './ui/AttachmentBadge';
import { AIModel } from '@/config/aiModels';

// ============================================================================
// VIEW COMPONENTS
// ============================================================================

/**
 * Loading state view
 */
export function LoadingView() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Loading your health records...</p>
      </div>
    </div>
  );
}

/**
 * Unauthenticated state view
 */
export function UnauthenticatedView() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Authentication Required</h2>
        <p className="text-gray-600 mb-6">Please sign in to access your AI Health Assistant.</p>
        <a
          href="/auth"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Sign In
        </a>
      </div>
    </div>
  );
}

/**
 * Error state view
 */
export function ErrorView({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <X className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Records</h2>
        <p className="text-gray-600 mb-6">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN VIEW
// ============================================================================

interface AIHealthAssistantViewProps {
  user: { uid: string; displayName?: string | null };
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  onSendMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  onClearChat: () => void;
  selectedModel: AIModel;
  availableModels: AIModel[];
  onModelChange: (model: AIModel) => void;
  healthContext: string | null;
  selectedContext: ContextSelection;
  onContextChange: (context: ContextSelection) => void;
  availableSubjects: SubjectInfo[];
  allRecords: FileObject[];
  getSubjectName: () => string | undefined;
  pendingAttachments?: ChatAttachment[];
  onPendingAttachmentsClear?: () => void;
  onStop?: () => void;
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
}

/**
 * Main AI Health Assistant view
 * Pure presentation component - receives all data and handlers via props
 */
export function AIHealthAssistantView({
  user,
  messages,
  isLoading,
  error,
  onSendMessage,
  onClearChat,
  selectedModel,
  availableModels,
  onModelChange,
  healthContext,
  selectedContext,
  onContextChange,
  availableSubjects,
  allRecords,
  getSubjectName,
  pendingAttachments,
  onPendingAttachmentsClear,
  onStop,
  onEditMessage,
}: AIHealthAssistantViewProps) {
  return (
    <div className="h-full mx-auto">
      {/* AI Chat Component */}
      <div className="rounded-xl h-full">
        <AIChat
          healthContext={healthContext}
          className=""
          messages={messages}
          isLoading={isLoading}
          error={error}
          onSendMessage={onSendMessage}
          onClearChat={onClearChat}
          selectedModel={selectedModel}
          availableModels={availableModels}
          onModelChange={onModelChange}
          pendingAttachments={pendingAttachments}
          onPendingAttachmentsClear={onPendingAttachmentsClear}
          contextInfo={{
            type: selectedContext.type,
            subjectName: getSubjectName(),
          }}
          leftFooterContent={
            <ContextSelector
              currentUserId={user.uid}
              availableSubjects={availableSubjects}
              allRecords={allRecords}
              selectedContext={selectedContext}
              onContextChange={onContextChange}
            />
          }
          aboveInputContent={
            messages.length === 0 ? (
              <div className="w-full max-w-3xl pt-12">
                {/* Welcome Header */}
                <div className="text-center">
                  <h1 className="text-4xl font-bold text-gray-900 mb-3">
                    Welcome back, {user.displayName || 'there'}
                  </h1>
                  <p className="text-lg text-gray-600">Ask me anything about your health records</p>
                </div>
              </div>
            ) : undefined
          }
          belowInputContent={
            messages.length === 0 && (
              <div className="max-w-3xl mx-auto mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Shield className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 text-sm">Private & Secure</h4>
                      <p className="text-xs text-gray-600 mt-1">
                        All chats are end-to-end encrypted and never used for AI training
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Sparkles className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 text-sm">Context-Aware</h4>
                      <p className="text-xs text-gray-600 mt-1">
                        Switch between different record contexts for precise answers
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <MessageSquare className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 text-sm">Natural Language</h4>
                      <p className="text-xs text-gray-600 mt-1">
                        Ask questions in plain English, just like talking to a doctor
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          }
          onMessagesChange={messageCount => {
            // Could track analytics here
            console.log('Message count changed:', messageCount);
          }}
          onStop={onStop}
          onEditMessage={onEditMessage}
        />
      </div>
    </div>
  );
}

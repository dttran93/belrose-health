// src/pages/AiPortal.tsx

/**
 * The main portal page for the AI Assistant App.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthContext } from '@/features/Auth/AuthContext';
import { SubjectInfo } from '@/features/Ai/components/ui/SubjectList';
import { ContextSelection } from '@/features/Ai/components/ui/ContextBadge';
import {
  getAccessibleRecords,
  getAvailableSubjects,
} from '@/features/Ai/service/recordContextService';
import {
  AIHealthAssistantView,
  LoadingView,
  UnauthenticatedView,
  ErrorView,
} from '@/features/Ai/components/AIAssistantView';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';
import { useAIChatContext } from '@/features/Ai/components/AIChatContext';
import { useFileDrop } from '@/hooks/useFileDrop';
import { FileDragOverlay } from '@/components/ui/FileDragOverlay';
import { ChatAttachment } from '@/features/Ai/components/ui/AttachmentBadge';
import { AIModel, UI_MODELS } from '@/config/aiModels';

export default function AIPortal() {
  const { user, loading: authLoading } = useAuthContext();

  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();

  // ============================================================================
  // CONTEXT — replaces useAIChat
  // ============================================================================

  const {
    currentChatId,
    messages,
    isLoadingMessages,
    isSendingMessage,
    chatError,
    handleSendMessage,
    handleEditMessage,
    handleLoadChat,
    handleNewChat,
    handleStopGeneration,
    selectedModel,
    setSelectedModel,
    selectedContext,
    setSelectedContext,
    allRecords,
    setAllRecords,
    refreshChats,
  } = useAIChatContext();

  // ============================================================================
  // DATA STATE
  // ============================================================================

  const [availableSubjects, setAvailableSubjects] = useState<SubjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // ============================================================================
  // UI STATE
  // ============================================================================

  // AI Model selection
  const availableModels: AIModel[] = UI_MODELS;
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);

  // ============================================================================
  // HOOKS
  // ============================================================================

  // Drag and drop
  const { isDragging } = useFileDrop({
    onDrop: (files: File[]) => {
      setPendingAttachments(files as ChatAttachment[]);
    },
    global: true,
  });

  // ============================================================================
  // ROUTING EFFECTS
  // ============================================================================

  // When URL has a chatId, load that chat
  useEffect(() => {
    if (chatId && chatId !== currentChatId) {
      handleLoadChat(chatId);
    }
  }, [chatId]);

  // When a new chat gets created (currentChatId changes from null),
  // update the URL so the user can refresh/share it
  useEffect(() => {
    if (currentChatId && !chatId) {
      navigate(`/app/ai/chat/${currentChatId}`, { replace: true });
      refreshChats(); // ✅ Update sidebar with the new chat
    }
  }, [currentChatId]);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  // Fetch all accessible records and subjects
  useEffect(() => {
    if (!user) {
      setAllRecords([]);
      setAvailableSubjects([]);
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        if (!user) {
          throw new Error('User Missing');
        }

        setLoading(true);

        // Fetch all records user has access to
        const records = await getAccessibleRecords(user.uid);

        // Decrypt Records
        const decryptedRecords = await RecordDecryptionService.decryptRecords(records);
        console.log('✅ Records decrypted:', decryptedRecords.length);

        setAllRecords(decryptedRecords);

        // Get available subjects from decrypted records
        const subjects = await getAvailableSubjects(decryptedRecords, user.uid);
        setAvailableSubjects(subjects);

        // Set initial context to user's own records
        const myRecords = records.filter(r => r.subjects?.includes(user.uid));
        setSelectedContext({
          type: 'my-records',
          subjectId: user.uid,
          recordIds: myRecords.map(r => r.id),
          recordCount: myRecords.length,
          description: `Your ${myRecords.length} health records`,
        });

        setError(null);
      } catch (err) {
        console.error('Error fetching records:', err);
        setError(err instanceof Error ? err : new Error('Failed to load health records'));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleContextChange = (newContext: ContextSelection) => {
    setSelectedContext(newContext);
  };

  const getSubjectName = () => {
    if (selectedContext.type === 'subject' && selectedContext.subjectId) {
      const subject = availableSubjects.find(s => s.id === selectedContext.subjectId);
      return subject?.firstName || 'Unknown';
    }
    return undefined;
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  // Loading state
  if (authLoading || loading) {
    return <LoadingView />;
  }

  // Not authenticated
  if (!user) {
    return <UnauthenticatedView />;
  }

  // Error state
  if (error) {
    return <ErrorView error={error} />;
  }

  // Main chat interface
  return (
    <div className="relative h-full">
      {/* Drag & Drop Overlay */}
      <FileDragOverlay isDragging={isDragging} />

      <AIHealthAssistantView
        user={user}
        messages={messages}
        isLoading={isSendingMessage || isLoadingMessages}
        error={chatError}
        onSendMessage={handleSendMessage}
        onClearChat={() => {
          handleNewChat();
          navigate('/app/ai', { replace: true }); // ✅ Clear URL when starting new chat
        }}
        selectedModel={selectedModel}
        availableModels={availableModels}
        onModelChange={setSelectedModel}
        healthContext={`${selectedContext.recordCount} records selected`}
        selectedContext={selectedContext}
        onContextChange={handleContextChange}
        availableSubjects={availableSubjects}
        allRecords={allRecords}
        getSubjectName={getSubjectName}
        pendingAttachments={pendingAttachments}
        onPendingAttachmentsClear={() => setPendingAttachments([])}
        onStop={handleStopGeneration}
        onEditMessage={handleEditMessage}
      />
    </div>
  );
}

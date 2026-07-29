// src/features/ViewEditRecord/hooks/useUserRecords.ts

import { FileObject } from '@/types/core';
import {
  collection,
  DocumentData,
  getFirestore,
  onSnapshot,
  or,
  orderBy,
  query,
  QuerySnapshot,
  where,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import mapFirestoreToFileObject from '../utils/firestoreMapping';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { toast } from 'sonner';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';

export type RecordFilterType = 'all' | 'subject' | 'owner' | 'uploaded';

interface RecordFilters {
  filterType: RecordFilterType;
  subjectId?: string; // Optional specific subject to filter by
}

interface UseUserRecordsReturn {
  records: FileObject[];
  loading: boolean;
  error: Error | null;
  refetchRecords: () => void;
}

export const useUserRecords = (
  userId?: string,
  filters: RecordFilters = { filterType: 'all' }
): UseUserRecordsReturn => {
  const [records, setRecords] = useState<FileObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refetchRecords = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  useEffect(() => {
    if (!userId) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const { filterType, subjectId } = filters;

    setLoading(true);
    setError(null);

    const db = getFirestore();
    const recordsRef = collection(db, 'records');

    let q;

    switch (filterType) {
      case 'subject':
        // If subjectId is provided, filter by that specific subject
        // Otherwise, filter by current user as subject
        const targetSubjectId = subjectId || userId;

        if (targetSubjectId === userId) {
          q = query(
            recordsRef,
            where('subjects', 'array-contains', targetSubjectId),
            orderBy('uploadedAt', 'desc')
          );
        } else {
          // Querying another person's records - must scope to what YOU can access
          // Then filter by subject client-side

          q = query(
            recordsRef,
            or(
              where('owners', 'array-contains', userId),
              where('administrators', 'array-contains', userId),
              where('sharers', 'array-contains', userId),
              where('viewers', 'array-contains', userId),
              where('subjects', 'array-contains', userId)
            ),
            orderBy('uploadedAt', 'desc')
          );
        }
        break;

      case 'owner':
        q = query(
          recordsRef,
          where('owners', 'array-contains', userId),
          orderBy('uploadedAt', 'desc')
        );
        break;

      case 'uploaded':
        q = query(recordsRef, where('uploadedBy', '==', userId), orderBy('uploadedAt', 'desc'));
        break;

      case 'all':
      default:
        q = query(
          recordsRef,
          or(
            where('owners', 'array-contains', userId),
            where('administrators', 'array-contains', userId),
            where('sharers', 'array-contains', userId),
            where('viewers', 'array-contains', userId),
            where('subjects', 'array-contains', userId)
          ),
          orderBy('uploadedAt', 'desc')
        );
    }

    const unsubscribe = onSnapshot(
      q,
      async (snapshot: QuerySnapshot<DocumentData>) => {
        try {
          const accessibleRecords: FileObject[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return mapFirestoreToFileObject(doc.id, data);
          });

          // When filtering by subject, ensure user still has access to these records
          const filteredRecords = accessibleRecords.filter(record => {
            // If filtering by a specific subject (not current user),
            // verify current user has permission to view
            if (subjectId && subjectId !== userId) {
              const hasAccess =
                record.owners?.includes(userId) ||
                record.administrators?.includes(userId) ||
                record.viewers?.includes(userId);

              if (!hasAccess) {
                console.warn('⚠️ User lacks permission for record:', record.id);
                return false;
              }
            }
            // If filtering by another user as subject, apply client-side subject filter
            if (filterType === 'subject' && subjectId && subjectId !== userId) {
              return record.subjects?.includes(subjectId);
            }
            return true;
          });

          // Decrypt encrypted records (your existing logic)
          const hasEncryptedRecords = filteredRecords.some((record: any) => record.isEncrypted);

          if (hasEncryptedRecords) {
            const masterKey = await EncryptionKeyManager.getSessionKey();

            if (!masterKey) {
              console.warn('⚠️ Encrypted records found but no encryption session active');
              toast.warning(
                'Some records are encrypted. Please unlock your encryption to view them.'
              );
              setRecords(filteredRecords);
              setLoading(false);
              return;
            }

            try {
              const decryptedRecords = await RecordDecryptionService.decryptRecords(
                filteredRecords as any
              );
              setRecords(decryptedRecords as FileObject[]);
            } catch (decryptError) {
              console.error('❌ Failed to decrypt records:', decryptError);
              toast.error(
                'Failed to decrypt some records. Please try unlocking your encryption again.'
              );
              setRecords(filteredRecords);
            }
          } else {
            setRecords(filteredRecords);
          }

          setLoading(false);
        } catch (processingError) {
          console.error('❌ Error processing records:', processingError);
          setError(processingError as Error);
          setLoading(false);
        }
      },
      err => {
        console.error('❌ Error fetching records:', err);
        setError(err as Error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [userId, filters.filterType, filters.subjectId, refreshTrigger]);

  return { records, loading, error, refetchRecords };
};

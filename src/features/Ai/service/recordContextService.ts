// src/features/AIChat/services/recordContextService.ts

import { collection, query, where, getDocs } from 'firebase/firestore';
import { getUserProfiles } from '@/features/Users/services/userProfileService';
import { FileObject } from '@/types/core';
import { db } from '@/firebase/config';
import { SubjectInfo } from '../components/ui/SubjectList';

/**
 * Fetch all records the current user has access to
 */
export async function getAccessibleRecords(userId: string): Promise<FileObject[]> {
  try {
    const recordsRef = collection(db, 'records');

    // Query for records where user is owner, viewer, or administrator
    // Note: Firestore doesn't support OR queries directly, so we need multiple queries
    const queries = [
      query(recordsRef, where('owners', 'array-contains', userId)),
      query(recordsRef, where('viewers', 'array-contains', userId)),
      query(recordsRef, where('administrators', 'array-contains', userId)),
      query(recordsRef, where('subjects', 'array-contains', userId)),
      query(recordsRef, where('sharers', 'array-contains', userId)),
    ];

    const snapshots = await Promise.all(queries.map(q => getDocs(q)));

    // Combine and deduplicate results
    const recordsMap = new Map<string, FileObject>();

    snapshots.forEach(snapshot => {
      snapshot.forEach(doc => {
        if (!recordsMap.has(doc.id)) {
          recordsMap.set(doc.id, {
            id: doc.id,
            ...doc.data(),
          } as FileObject);
        }
      });
    });

    return Array.from(recordsMap.values());
  } catch (error) {
    console.error('Error fetching accessible records:', error);
    throw error;
  }
}

/**
 * Get all unique subjects from accessible records with their profiles
 */
export async function getAvailableSubjects(
  records: FileObject[],
  currentUserId: string
): Promise<SubjectInfo[]> {
  try {
    // Extract unique subject IDs from all records
    // Note: subjects is an array in FileObject, so we need to flatten
    const allSubjectIds = records.flatMap(r => r.subjects || []);
    const subjectIds = [...new Set(allSubjectIds)];

    // Fetch user profiles for all subjects
    const profiles = await getUserProfiles(subjectIds);

    // Build subject info array
    const subjects: SubjectInfo[] = subjectIds.map(subjectId => {
      const profile = profiles.get(subjectId);
      // Count records where this subjectId appears in the subjects array
      const recordCount = records.filter(r => r.subjects?.includes(subjectId)).length;

      return {
        id: subjectId,
        name: profile?.displayName || `User ${subjectId}`,
        firstName: profile?.firstName || 'Unknown',
        recordCount,
        isCurrentUser: subjectId === currentUserId,
      };
    });

    // Sort: current user first, then by name
    return subjects.sort((a, b) => {
      if (a.isCurrentUser) return -1;
      if (b.isCurrentUser) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error('Error getting available subjects:', error);
    throw error;
  }
}

/**
 * Filter records based on context selection
 */
export function filterRecordsByContext(
  records: FileObject[],
  contextType: string,
  subjectId?: string | null,
  recordIds?: string[]
): FileObject[] {
  if (contextType === 'specific-records' && recordIds) {
    return records.filter(r => recordIds.includes(r.id));
  }

  if (contextType === 'subject' && subjectId) {
    // Filter records where the subjects array includes this subjectId
    return records.filter(r => r.subjects?.includes(subjectId));
  }

  if (contextType === 'my-records') {
    // This will be filtered by the calling code with currentUserId
    return records;
  }

  if (contextType === 'all-accessible') {
    return records;
  }

  return [];
}

// test/orchestration/useRecordsWithCredibility.test.ts
//
// Orchestration test for fetchRecordsWithCredibility (src/features/BackendChainParity/hooks/
// useRecordsWithCredibility.ts) — the shared base fetch behind both useRecordSubjectsIntegrity
// and useRecordHashesIntegrity. Real Firestore emulator (records, verifications, disputes,
// records/{id}/recordHashHistory); no chain calls at all in this function, so nothing to mock.
//
// Like useChainOnlyMembers.ts, this hook computes `const db = getFirestore(getApp())` at MODULE
// load time — must be imported AFTER connectTestFirestore() via a deferred dynamic import, or it
// throws "No Firebase App '[DEFAULT]' has been created" (confirmed empirically once, see that
// test file's header comment for the full explanation).

import { describe, it, expect, beforeEach } from 'vitest';
import { doc, setDoc, collection } from 'firebase/firestore';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';

const db = connectTestFirestore('belrose-orchestration-records-with-credibility');

const { fetchRecordsWithCredibility } = await import(
  '../../src/features/BackendChainParity/hooks/useRecordsWithCredibility'
);

describe('fetchRecordsWithCredibility', () => {
  beforeEach(async () => {
    await clearTestFirestore();
  });

  it('returns an empty records array and an empty hashesEverAnchored set when nothing exists', async () => {
    const result = await fetchRecordsWithCredibility();

    expect(result.records).toEqual([]);
    expect(result.hashesEverAnchored.size).toBe(0);
  });

  it('returns every record with its Firestore id attached', async () => {
    await seedRecord(db, 'record-1', { owners: ['owner-1'] });
    await seedRecord(db, 'record-2', { owners: ['owner-2'] });

    const result = await fetchRecordsWithCredibility();

    expect(result.records.map(r => r.id).sort()).toEqual(['record-1', 'record-2']);
  });

  it('unions a verification doc\'s recordHash into hashesEverAnchored, lowercased', async () => {
    await setDoc(doc(collection(db, 'verifications'), 'ver-1'), {
      recordHash: '0xHashFromVerification',
    });

    const result = await fetchRecordsWithCredibility();

    expect(result.hashesEverAnchored.has('0xhashfromverification')).toBe(true);
  });

  it('unions a dispute doc\'s recordHash into hashesEverAnchored, lowercased', async () => {
    await setDoc(doc(collection(db, 'disputes'), 'dispute-1'), {
      recordHash: '0xHashFromDispute',
    });

    const result = await fetchRecordsWithCredibility();

    expect(result.hashesEverAnchored.has('0xhashfromdispute')).toBe(true);
  });

  it('unions a records/{id}/recordHashHistory doc\'s hash into hashesEverAnchored, lowercased', async () => {
    await seedRecord(db, 'record-1', { owners: ['owner-1'] });
    await setDoc(doc(collection(db, 'records', 'record-1', 'recordHashHistory'), 'event-1'), {
      hash: '0xHashFromHistory',
    });

    const result = await fetchRecordsWithCredibility();

    expect(result.hashesEverAnchored.has('0xhashfromhistory')).toBe(true);
  });

  it('keys hashesEverAnchored by hash, not by recordId — a verification against a superseded hash still counts', async () => {
    // The record's CURRENT hash differs from the hash a (now-stale) verification targeted —
    // the set must still contain that stale hash, since the union is keyed by hash value alone.
    await seedRecord(db, 'record-1', { owners: ['owner-1'] });
    await setDoc(doc(db, 'records', 'record-1'), { recordHash: '0xCurrentHash' }, { merge: true });
    await setDoc(doc(collection(db, 'verifications'), 'ver-1'), {
      recordId: 'record-1',
      recordHash: '0xSupersededHash',
    });

    const result = await fetchRecordsWithCredibility();

    expect(result.hashesEverAnchored.has('0xsupersededhash')).toBe(true);
    expect(result.hashesEverAnchored.has('0xcurrenthash')).toBe(false);
  });
});

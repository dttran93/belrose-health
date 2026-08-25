"use strict";
// functions/src/credibility/earnedTrust.ts
//
// Phase 2 of the User Credibility batch cycle: EarnedTrust(u) = max(CredentialFloor(u),
// AvgRecordCredibility(u) + DisputeAccuracy(u) - CulpabilityPenalty(u) - UnacceptedRecordsPenalty(u)).
//
// Split into an I/O function (fetchEarnedTrustInputs) and a pure function (computeEarnedTrust) so
// the actual math is unit-testable against synthetic inputs without an emulator.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchEarnedTrustInputs = fetchEarnedTrustInputs;
exports.computeEarnedTrust = computeEarnedTrust;
const _shared_1 = require("../_shared");
const constants_1 = require("./constants");
const GET_ALL_CHUNK_SIZE = 300; // Firestore getAll() is safe well below its documented limits at this size
/**
 * Fetches everything Phase 2 needs: every user (for CredentialFloor + warm-start), every active
 * verification, every dispute (unfiltered — D(u)/I(u) both draw from the full set per the
 * whitepaper), and just the records referenced by those verifications (not a full `records` scan
 * — that collection also holds unrelated encrypted health data and could be much larger).
 */
async function fetchEarnedTrustInputs(db) {
    const [usersSnap, verificationsSnap, disputesSnap, unacceptedFlagsSnap, subjectHistorySnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('verifications').where('isActive', '==', true).get(),
        db.collection('disputes').get(),
        db.collection('unacceptedFlags').where('isActive', '==', true).get(),
        // Unfiltered — no collectionGroup index needed for a bare scan; filtering to anchor
        // actions and deduping by recordId happens in memory below, same as
        // disputesByUser/verificationsByUser are already built in computeEarnedTrust.
        db.collectionGroup('subjectHistory').get(),
    ]);
    const users = usersSnap.docs.map(userDoc => {
        const data = userDoc.data();
        return {
            uid: userDoc.id,
            credentialFloor: data.credentialFloor ?? constants_1.DEFAULT_CREDENTIAL_FLOOR,
            priorScore: data.credibility?.score ?? null,
        };
    });
    const verifications = verificationsSnap.docs.map(d => d.data());
    const disputes = disputesSnap.docs.map(d => d.data());
    const recordIds = Array.from(new Set(verifications.map(v => v.recordId)));
    const records = new Map();
    for (let i = 0; i < recordIds.length; i += GET_ALL_CHUNK_SIZE) {
        const chunk = recordIds.slice(i, i + GET_ALL_CHUNK_SIZE);
        const refs = chunk.map(id => db.collection('records').doc(id));
        if (refs.length === 0)
            continue;
        const snaps = await db.getAll(...refs);
        snaps.forEach(snap => {
            if (!snap.exists)
                return;
            const data = snap.data();
            records.set(snap.id, {
                recordHash: data.recordHash,
                credibilityScore: data.credibility?.score ?? _shared_1.INITIAL_SCORE,
            });
        });
    }
    const unacceptedFlagCounts = new Map();
    unacceptedFlagsSnap.docs.forEach(d => {
        const subjectId = d.data().subjectId;
        unacceptedFlagCounts.set(subjectId, (unacceptedFlagCounts.get(subjectId) ?? 0) + 1);
    });
    // S(u) per the contract's own never-pruned definition: every record ever anchored, not just
    // currently-active ones — a user who later unanchors a record for unrelated reasons (privacy,
    // switching providers) shouldn't see their denominator shrink and their refusal ratio jump.
    const everAnchoredRecordIds = new Map(); // subjectId -> Set<recordId>
    subjectHistorySnap.docs.forEach(d => {
        const data = d.data();
        if (data.action !== 'anchored' && data.action !== 'anchored_as_controller')
            return;
        const set = everAnchoredRecordIds.get(data.subjectId) ?? new Set();
        set.add(data.recordId);
        everAnchoredRecordIds.set(data.subjectId, set);
    });
    const everAnchoredRecordCounts = new Map([...everAnchoredRecordIds].map(([subjectId, set]) => [subjectId, set.size]));
    return {
        users,
        verifications,
        disputes,
        records,
        unacceptedFlagCounts,
        everAnchoredRecordCounts,
    };
}
function average(values) {
    if (values.length === 0)
        return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}
/**
 * Pure: given EarnedTrustInputs, computes EarnedTrust(u) and its breakdown for every user.
 */
function computeEarnedTrust(inputs) {
    const verificationsByUser = new Map();
    for (const v of inputs.verifications) {
        const list = verificationsByUser.get(v.verifierId) ?? [];
        list.push(v);
        verificationsByUser.set(v.verifierId, list);
    }
    const disputesByUser = new Map();
    const disputesByRecordHash = new Map();
    for (const d of inputs.disputes) {
        const byUser = disputesByUser.get(d.disputerId) ?? [];
        byUser.push(d);
        disputesByUser.set(d.disputerId, byUser);
        const byHash = disputesByRecordHash.get(d.recordHash) ?? [];
        byHash.push(d);
        disputesByRecordHash.set(d.recordHash, byHash);
    }
    const results = new Map();
    for (const user of inputs.users) {
        // R(u): active verifications matching the record's CURRENT recordHash only — a verification
        // against a since-superseded version no longer speaks to what the record currently says,
        // consistent with how record credibility itself resets on edit.
        const currentHashVerifications = (verificationsByUser.get(user.uid) ?? []).filter(v => {
            const record = inputs.records.get(v.recordId);
            return record !== undefined && record.recordHash === v.recordHash;
        });
        const avgRecordCredibility = average(currentHashVerifications.map(v => inputs.records.get(v.recordId).credibilityScore));
        // D(u): ALL disputes filed by u, no active/current-hash filter — the whitepaper states this
        // as literally "all disputes filed by user u." Pending disputes (validationWeight === 0)
        // contribute 0 to the sum but still count toward the denominator, diluting the average until
        // resolved — exactly as the formula states.
        const userDisputes = disputesByUser.get(user.uid) ?? [];
        const disputeAccuracy = average(userDisputes.map(d => constants_1.DISPUTE_SEVERITY_WEIGHTS[d.severity] * d.validationWeight));
        // I(u): disputes against the SAME recordHash u actively verified — symmetric with D(u), no
        // isActive filter on the disputes themselves (a retracted dispute is still a permanent
        // record). Dedup by dispute id in case two of u's verifications somehow shared a recordHash.
        const seenDisputeIds = new Set();
        const culpabilityDisputes = [];
        for (const v of currentHashVerifications) {
            for (const d of disputesByRecordHash.get(v.recordHash) ?? []) {
                if (seenDisputeIds.has(d.id))
                    continue;
                seenDisputeIds.add(d.id);
                culpabilityDisputes.push(d);
            }
        }
        const culpabilityPenalty = culpabilityDisputes.length === 0
            ? 0
            : (average(culpabilityDisputes.map(d => constants_1.CULPABILITY_WEIGHTS[d.culpability] * d.validationWeight)) ?? 0);
        // UnacceptedRecordsPenalty(u) = (|U(u)|/|S(u)|) * constant. S(u) = 0 means no anchor history
        // to judge a refusal ratio against — treated as no penalty (0), not maximal, matching this
        // codebase's existing "no data" != "worst possible data" convention (see avgRecordCredibility/
        // disputeAccuracy being null, not 0, above) rather than catastrophically penalizing a
        // brand-new user off a single flag with an empty denominator.
        const flaggedCount = inputs.unacceptedFlagCounts.get(user.uid) ?? 0;
        const everAnchoredCount = inputs.everAnchoredRecordCounts.get(user.uid) ?? 0;
        const unacceptedRecordsPenalty = everAnchoredCount === 0
            ? 0
            : (flaggedCount / everAnchoredCount) * constants_1.UNACCEPTED_RECORDS_PENALTY_CONSTANT;
        const earnedTrust = Math.max(user.credentialFloor, (avgRecordCredibility ?? 0) + (disputeAccuracy ?? 0) - culpabilityPenalty - unacceptedRecordsPenalty);
        results.set(user.uid, {
            earnedTrust,
            avgRecordCredibility,
            disputeAccuracy,
            culpabilityPenalty,
            unacceptedRecordsPenalty,
            credentialFloor: user.credentialFloor,
        });
    }
    return results;
}
//# sourceMappingURL=earnedTrust.js.map
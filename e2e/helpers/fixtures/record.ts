// e2e/helpers/fixtures/record.ts
//
// A real, pre-existing record — uploaded once through the real app by the fixture guardian
// (see guardian.ts) specifically for e2e sharing tests, on real staging (belrose-757fe).
//
// Unlike guardian.ts, there's no reseedable snapshot here and no emulator equivalent: this
// record's encrypted content lives in real Cloud Storage plus a real Firestore doc, both created
// through the real upload pipeline — not something an Admin-SDK doc write can fake. Specs that
// use this fixture (e.g. recordShareGuestClaim.spec.ts) are staging-only for that reason.

export const RECORD_ID = 'Iw5Si3gmU3FtVTf8lTVk';

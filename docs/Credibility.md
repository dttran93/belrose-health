# Belrose Credibility System

## Why a Credibility System

Anchoring and hashing record content (see [Encryption.md](Encryption.md) and the smart contract docs) proves a record hasn't been tampered with since it was approved — its **fidelity**. Providers flagging unanchored records addresses **completeness** — lies of omission. Neither says anything about whether the record's contents are actually true. A falsified diagnosis can be perfectly hashed and utterly complete. That third question — **credibility** — can't be settled by cryptography. It has to be earned through a network of other participants attesting to, disputing, and vouching for records and each other.

This doc describes how that system is actually implemented: the on-chain primitives, the two credibility formulas, the constants that tune them, and the batch pipeline that keeps them up to date. For the full design rationale behind these choices, see `Belrose Credibility Whitepaper`.

---

## The Three Primitives

| Primitive        | What it does                                                    | Levels / dimensions                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verification** | Attests that a specific record meets a level of trust           | `Provenance` (created by who it claims), `Content` (reviewer agrees with the substance), `Full` (both)                                                                       |
| **Dispute**      | Flags an inaccuracy in a specific record                        | `Severity`: Negligible / Moderate / Major — clinical impact.<br>`Culpability`: Unknown / No Fault / Systemic / Preventable / Reckless / Intentional — why the error happened |
| **Vouch**        | One user's trust statement in another, across all their records | Active or Retracted — additive only, no negative "anti-vouch"                                                                                                                |

All three are on-chain actions, defined in `contracts/smartContracts/HealthRecordCore.sol` (verifications and disputes, enums at lines ~558–579) and `contracts/smartContracts/MemberRoleManager.sol` (vouches, `VouchStatus` enum at line ~1765). Firestore mirrors each primitive with a `pending → confirmed/failed` (`chainStatus`) write pattern — writes land in Firestore first, then get anchored on-chain. Full contract API reference: [contracts/HealthRecordCore.md](contracts/HealthRecordCore.md), [contracts/MemberRoleManager.md](contracts/MemberRoleManager.md).

---

## Two Scores

The primitives above feed two distinct scores, both on a **0–1000 scale**:

- **Record Credibility Score** — how much should a third party trust the content of _this specific record_. Driven by verifications and disputes against that record.
- **User Credibility Score** — how much should the network trust _this participant's judgement in general_. Driven by the credibility of records they've verified, disputes for/against them, and vouches from other users.

Each verification or dispute is weighted by the credibility of the person making it — a verification from a highly credible provider moves a record's score more than the same verification from a brand-new user.

---

## Record Credibility Score

Records begin from a neutral prior and move as evidence accumulates, via a Bayesian-average formula:

```
RecordScore(r) = [C · BasePrior + ΣVerificationContribution(v) − ΣDisputeContribution(d)]
                 / [C + |verifications| + |disputes|]

VerificationContribution(v) = VerificationLevel(v) · NormalizedCredibility(verifier)
DisputeContribution(d)      = DisputeSeverity(d) · NormalizedCredibility(disputer)
```

`NormalizedCredibility` is given as UserCredibility/AverageUserCredibility and is the mechanism through which more credible users have more influence on the system. It's frozen at the moment the verification/dispute is created (`normalizedCredibilityAtCreation`) and never recomputed afterward — not even when the verifier's/disputer's own `UserCredibility` later rises or falls. The current reasoning for not updating record scores when UserCredibility scores change is:

- **Anti-gaming / fairness.** A verification should count for what the verifier's standing _was_ when they made the call, not drift with their reputation afterward. Unfreezing it would create the potential for a record's credibility to change because of a verifier's unrelated behavior — versus evidence about the record itself.
- **Keeping Record Credibility live and cheap.** Record scores are event-sourced — `aggregateRecordScore` just replays a small `scoreEvents` list per record, with no batch pass required. Unfreezing `NormalizedCredibility` would mean a record's score could move with zero new verifications or disputes, purely because a contributor's credibility shifted elsewhere, which would in turn require periodically re-deriving every affected record's score — over the `records` collection, which the batch cycle deliberately never scans wholesale (see `fetchEarnedTrustInputs`'s comment on avoiding exactly that).

Only **severity** drives a record's score — culpability plays no role here. Culpability instead feeds `CulpabilityPenalty(u)` in the _user_ formula below.

### Constants (`packages/shared/src/credibility.ts`)

| Constant                          | Value                                         | Meaning                                                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INITIAL_SCORE`                   | `500`                                         | BasePrior — the neutral starting point for a record (and a user's warm-start)                                                                                                                                                                     |
| `RECORD_SCORE_C`                  | `5`                                           | How many pieces of evidence it takes to outweigh the prior. Weights top out around 100–150 (dispute) to 950 (verification), so `C=5` means the prior fades fast                                                                                   |
| `RECORD_VERIFICATION_WEIGHTS`     | Provenance `650`, Content `800`, Full `950`   | Must sit _above_ `INITIAL_SCORE` — the formula blends contributions in as part of an average, so a weight below the prior would drag a genuinely positive verification's score down (same reason one low rating drags down an IMDB-style average) |
| `RECORD_DISPUTE_SEVERITY_WEIGHTS` | Negligible `100`, Moderate `300`, Major `600` | Subtracted directly from the numerator — unlike verification weights, these don't need to clear any threshold to have an effect                                                                                                                   |

All are explicit placeholders pending real-world tuning (see [Known Limitations](#known-limitations--not-yet-implemented) below).

### Score bands (client display)

| Range   | Label     |
| ------- | --------- |
| 0–299   | Poor      |
| 300–499 | Fair      |
| 500–699 | Good      |
| 700–849 | Very Good |
| 850–999 | Excellent |

### Where it lives

- `packages/shared/src/credibility.ts` — `aggregateRecordScore()`, the one shared implementation both sides replay `scoreEvents` through so the math never drifts between client and server.
- `src/features/CredibilityRecord/services/credibilityScoreService.ts` — client-side: creates `scoreEvents`, freezes `normalizedCredibilityAtCreation`, and caches the replayed score on the record.
- `functions/src/credibility/validationWeightEvaluator.ts` — server-side replay, used to check whether a disputed record's score has moved (see [ValidationWeight](#validationweight--how-disputes-get-judged)).

**Editing a record resets its score.** Each `scoreEvent` is tagged with the `recordHash` it applies to, and a record's cached score is always recomputed scoped to its _current_ hash. Editing a record's content bumps `recordHash`, and the new hash starts with zero events — i.e. a fresh `INITIAL_SCORE`, even though the record has a verification/dispute history under its old hash. We contemplated having a record credibility score that is some kind of average of the scores of the associated hashes. However, that would open the system up to potential fraud. Because of end-to-end encryption and patient sovereignty over the record, we have no way to know what kind of changes were made to a record. If record credibility took into account previousHashes, a user could potentially take a credible record, completely change the content, and the changed record would inherit the high credibility of the original record. As a result, record credibility is always tied to the latest/current recordHash alone.

---

## User Credibility Score

A user's credibility is a blend of trust they've earned directly and trust propagated to them through the vouch network (EigenTrust/PageRank-style):

```
UserCredibility(u) = (1 − w) · EarnedTrust(u) + w · Σ[VouchWeight(u1 → u) · UserCredibility(u1)]

EarnedTrust(u) = max(
  CredentialFloor(u),
  AvgRecordCredibility(u) + DisputeAccuracy(u) − CulpabilityPenalty(u) − UnacceptedRecordsPenalty(u)
)
```

| Term                          | Meaning                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CredentialFloor(u)`          | Admin-set minimum for pre-trusted/credentialed users (e.g. verified clinicians), bootstrapping the network. Defaults to `DEFAULT_CREDENTIAL_FLOOR = 0`                                                                                                        |
| `AvgRecordCredibility(u)`     | Average score of the records `u` has actively verified — scoped to the record's **current** hash only. A verification against a since-superseded version of a record no longer speaks to what the record says now                                             |
| `DisputeAccuracy(u)`          | Average of `severity weight × ValidationWeight` over every dispute `u` has ever filed. Pending disputes contribute `0` but still count toward the average, diluting it until resolved                                                                         |
| `CulpabilityPenalty(u)`       | Average of `culpability weight × ValidationWeight` over disputes filed against records `u` actively verified (deduped by dispute)                                                                                                                             |
| `UnacceptedRecordsPenalty(u)` | `(flagged / everAnchored) × UNACCEPTED_RECORDS_PENALTY_CONSTANT`, penalizing a user who was asked to anchor a record attributed to them and refused. `0` if they've never had a record anchored to them at all (no baseline to judge a refusal ratio against) |

`AvgRecordCredibility` and `DisputeAccuracy` are `null` — not `0` — when the user has no records verified / no disputes filed. "No data" is deliberately distinct from "bad score" throughout this system.

`VouchWeight(u1 → u) = 1 / |V(u1)|` — a voucher's outgoing trust splits evenly across everyone they vouch for, so vouching for more people dilutes each vouch rather than amplifying the voucher's reach.

`NormalizedCredibility(u) = UserCredibility(u) / AvgUserCredibility` — used above to weight verification/dispute contributions. Falls back to a neutral `1.0` if the user has no score yet or the network has no `AvgUserCredibility` yet (e.g. a brand-new network). `AvgUserCredibility` is read from `credibilityStats/global` (`src/features/CredibilityUser/services/networkCredibilityStatsService.ts`).

### Constants (`functions/src/credibility/constants.ts`)

| Constant                              | Value                                                                                              | Meaning                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VOUCH_MIXING_WEIGHT` (`w`)           | `0.2`                                                                                              | 20% of a user's score comes from the vouch network, 80% from `EarnedTrust` directly                                                                          |
| `DEFAULT_CREDENTIAL_FLOOR`            | `0`                                                                                                | `CredentialFloor(u)` for users without an admin-set floor                                                                                                    |
| `DISPUTE_SEVERITY_WEIGHTS`            | Negligible `50`, Moderate `150`, Major `300`                                                       | Feeds `DisputeAccuracy(u)`                                                                                                                                   |
| `CULPABILITY_WEIGHTS`                 | Unknown `100`, No Fault `50`, Systemic `100`, Preventable `200`, Reckless `350`, Intentional `500` | Feeds `CulpabilityPenalty(u)`                                                                                                                                |
| `UNACCEPTED_RECORDS_PENALTY_CONSTANT` | `500`                                                                                              | Scales the refusal ratio into a 0–1000 deduction — set on the same order as culpability's top tier since a high refusal ratio is a comparably serious signal |
| `MAX_POWER_ITERATIONS`                | `50`                                                                                               | Safety cap on vouch-propagation iterations (backstop, not the expected count)                                                                                |
| `CONVERGENCE_EPSILON`                 | `0.5`                                                                                              | Iteration stops once no user's score moves more than this between rounds                                                                                     |

**Important:** `DISPUTE_SEVERITY_WEIGHTS` and `CULPABILITY_WEIGHTS` here are **separate constants from** `RECORD_DISPUTE_SEVERITY_WEIGHTS` in the Record Credibility section above — same-shaped `Record<severity/culpability, number>`, different files, different scale, different purpose (one moves a _record's_ score, these move a _user's_ `EarnedTrust`). The code comments in both files call this out explicitly to avoid the two ever being conflated or accidentally merged.

### Where it lives

- `functions/src/credibility/earnedTrust.ts` — `computeEarnedTrust()`, the `EarnedTrust(u)` formula and its four components.
- `functions/src/credibility/vouchPropagation.ts` — `runVouchPropagation()`, the power-iteration solve for the full `UserCredibility(u)` formula.
- `functions/src/credibility/constants.ts` — all constants above.

---

## ValidationWeight — How Disputes Get Judged

`ValidationWeight(d)` decides whether a filed dispute turns out to have been right. It's not a simple timer — it's a state machine implemented in `functions/src/credibility/validationWeightEvaluator.ts`:

1. A dispute starts **pending (`0`)**.
2. After `EVALUATION_WINDOW_DAYS = 90` has elapsed, it's re-checked against the record's score _as of that dispute's `recordHash`_ (replayed via `computeRecordScoreForHash`), compared to the score frozen on the dispute at filing time (`recordScoreAtCreation`):
   - Score **declined** → **validated (`1`)**
   - Score **increased** → **unvalidated (`-1`)**
   - Score **unchanged** → **stays pending**, re-checked again next cycle

The "unchanged → stays pending" rule is deliberate: medical records get re-reviewed rarely, so "nobody has looked again yet" is the common case, not the exception. Resolving silence as validated would let anyone win a `DisputeAccuracy` boost just by filing and waiting; resolving it as unvalidated would punish a disputer for something outside their control. Only an actual score movement freezes an outcome. Once set, `validationWeight` is never touched again.

---

## The Nightly Batch Cycle

User Credibility (unlike Record Credibility, which updates live on every verification/dispute) is recomputed in periodic batch cycles. `runUserCredibilityCycle()` (`functions/src/credibility/userCredibilityBatchService.ts`) runs the phases in order:

1. **`evaluatePendingDisputes`** — freeze `ValidationWeight` for any dispute past its evaluation window.
2. **`fetchEarnedTrustInputs` + `computeEarnedTrust`** — compute `EarnedTrust(u)` for every user.
3. **`runVouchPropagation`** — Jacobi-style power iteration over active vouch edges (every user's next value computed from the _previous_ round, so the result doesn't depend on iteration order). Warm-started from the prior cycle's converged score (pure optimization — all starting points converge to the same fixed point, warm-start just needs fewer rounds). Capped at `MAX_POWER_ITERATIONS`, stops early once `CONVERGENCE_EPSILON` is satisfied.
4. **Batched write-back** to `users/{uid}.credibility` — this field is server-write-only; no client can ever set it directly (`firestore.rules`).
5. **Write `credibilityStats/global`** — `avgUserCredibility` (mean of this cycle's scores) and `scoredUserCount`, always written even when there are no users yet (`0`/`0`, never omitted), so readers never need an existence check.

**Trigger:** `functions/src/handlers/userCredibilityBatch.ts` — `runUserCredibilityBatch` runs on a schedule, daily at 03:00 (`onSchedule('0 3 * * *', ...)`). `recomputeUserCredibility` is an admin-gated (`platformAdmin` custom claim) manual `onCall` trigger for forcing a recompute during ops/dev.

---

## Data Model

| Collection                            | Doc ID                      | Writable by                                                                                                    | Purpose                                                                                                 |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `verifications/{id}`                  | `{recordHash}_{verifierId}` | Client (role-gated); `normalizedCredibilityAtCreation` frozen at creation                                      | A verification on a specific record hash                                                                |
| `disputes/{id}`                       | `{recordHash}_{disputerId}` | Client on create; `validationWeight` only via the server-only branch in the batch cycle                        | A dispute on a specific record hash                                                                     |
| `vouches/{id}`                        | `{voucherId}_{voucheeId}`   | Client (writes `chainStatus` lifecycle: `Pending → Active/Failed`, or `→ Retracted`); permanent, never deleted | One user's trust statement in another                                                                   |
| `unacceptedFlags/{id}`                | `{subjectId}_{recordId}`    | Admin SDK only                                                                                                 | A provider-raised flag that a subject refused to anchor a record attributed to them                     |
| `records/{recordId}/scoreEvents/{id}` | auto                        | Client-creatable (role-gated), immutable after                                                                 | Append-only audit trail of everything that moved a record's score                                       |
| `users/{uid}.credibility`             | —                           | Server only (batch cycle)                                                                                      | The user's `UserCredibilityScore` — final score plus the full `EarnedTrust` breakdown, for transparency |
| `credibilityStats/global`             | `global` (singleton)        | Server only (batch cycle)                                                                                      | Network-wide `avgUserCredibility` / `scoredUserCount`                                                   |

---

## Known Limitations / Not Yet Implemented

The whitepaper flags several areas as intentionally deferred for future research. None of the following are implemented yet:

- **Tuned constants** — every weight and constant above is an explicit placeholder pending real-world research into outcomes; none are researched/final values.
  - These can be tuned in `packages/shared/src/credibility.ts` for Record Credibility. Or `functions/src/credibility/constants.ts` for User Credibility (Backend because calculation is done server-side)
- **Maximum influence cap** — no ceiling yet on how much a cluster of high-`NormalizedCredibility` users could dominate scoring.
- **Rating deviation / decay** — no Glicko-style confidence decay for users who go inactive after earning a high score.
- **Collusion detection** — no minimum-distinct-verifiers rule or graph analysis to catch low-credibility users propping each other up via mutual verification.
- **Domain expertise weighting** — a cardiologist's verification of a cardiac diagnosis currently carries the same weight as any other verifier's; no specialty-aware weighting exists (complicated further by end-to-end encryption of record content).
- **True error rate estimation** — no independent evaluation of how much of the real-world inaccuracy rate the observed (and inherently sparse) dispute signal actually captures.
- **Record Credibility isn't batch-recomputed.** Only User Credibility runs the periodic convergence cycle the whitepaper describes for both scores — Record Credibility stays live/event-sourced with `NormalizedCredibility` frozen at contribution time (see [Record Credibility Score](#record-credibility-score) above). Whether to periodically refresh past contributions' weight against each cycle's newly-converged `NormalizedCredibility` is an open design question, not a decision that's been made either way.

See `Belrose Credibility Whitepaper` for the full reasoning behind the design.

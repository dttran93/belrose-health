// functions/src/credibility/vouchPropagation.ts
//
// Phase 3 of the User Credibility batch cycle: the iterative (EigenTrust/PageRank-style) solve
// for UserCredibility(u) = (1-w)·EarnedTrust(u) + w·Σ[VouchWeight(u1→u)·UserCredibility(u1)].
//
// Fully pure — zero Firestore imports — so this is unit-testable against synthetic graphs without
// an emulator. Jacobi-style power iteration (every user's `next` value computed from the PREVIOUS
// iteration's values, swapped once per round) rather than Gauss-Seidel in-place mutation, so the
// result doesn't depend on user iteration order — standard for PageRank/EigenTrust.

import { SCORE_BOUNDS } from '../_shared';
import type { VouchEdge, VouchPropagationResult } from './types';

export interface VouchPropagationParams {
  /** uid -> EarnedTrust(u), already computed and clamped 0-1000. */
  earnedTrust: Map<string, number>;
  /** Active vouches only. */
  vouchEdges: VouchEdge[];
  /** uid -> prior cycle's users/{uid}.credibility.score. Missing entries fall back to EarnedTrust. */
  warmStart: Map<string, number>;
  w: number;
  maxIterations: number;
  epsilon: number;
}

// Deliberately NOT @belrose/shared's clampScore — that one rounds to the nearest integer, which
// is right for a FINAL stored/displayed score but wrong here: this runs every power-iteration
// round on values that feed straight into the next round's math. Rounding each pass would
// quantize the state by a whole point per iteration, which (with epsilon = 0.5) can make a value
// oscillate between two adjacent integers forever and never actually converge. Bounds still
// apply — just without rounding away the fractional precision iteration needs.
function clamp(value: number): number {
  return Math.max(SCORE_BOUNDS.MIN, Math.min(SCORE_BOUNDS.MAX, value));
}

export function runVouchPropagation(
  params: VouchPropagationParams
): Map<string, VouchPropagationResult> {
  const { earnedTrust, vouchEdges, warmStart, w, maxIterations, epsilon } = params;
  const uids = Array.from(earnedTrust.keys()); //Basically the list of all users

  // VouchWeight(u1->u) = 1/|V(u1)| — a voucher's outgoing trust splits evenly across everyone
  // they vouch for. Only count edges whose voucher is a known scored user (defensive). Out-Degree
  // is a graph theory term describing the number of outgoing edges from a node. In this case,
  // the number of vouchees a voucher has.
  const outDegree = new Map<string, number>();
  for (const edge of vouchEdges) {
    if (!earnedTrust.has(edge.voucherId)) continue;
    outDegree.set(edge.voucherId, (outDegree.get(edge.voucherId) ?? 0) + 1);
  }

  // Build the incoming edges map for each user. Includes who vouched for the vouchee and the weight of that vouch (1/outDegree)
  const incoming = new Map<string, Array<{ voucherId: string; weight: number }>>();
  for (const edge of vouchEdges) {
    if (!earnedTrust.has(edge.voucherId) || !earnedTrust.has(edge.voucheeId)) continue;
    const degree = outDegree.get(edge.voucherId) ?? 0;
    if (degree === 0) continue;
    const list = incoming.get(edge.voucheeId) ?? [];
    list.push({ voucherId: edge.voucherId, weight: 1 / degree });
    incoming.set(edge.voucheeId, list);
  }

  // Initialization vector, start with prior cycle's score if available. Default to earned trust for new users. But TBH this doesn't matter,
  // all scores converge to the same result regardless of starting point, warm-start just reduces the number of iterations required
  let current = new Map<string, number>();
  for (const uid of uids) {
    current.set(uid, warmStart.get(uid) ?? earnedTrust.get(uid)!);
  }

  let finalVouchPropagated = new Map<string, number>();

  // Loop within a loop. Outer loop is the power iteration within which you set the score for the iteration for each user.
  // Inner loop, loops through each user and calculates a new score based on the previous iteration's scores.
  // When a convergence condition is met (the scores aren't changing anymore) or when you reach the max number of iterations the outer loop breaks
  // and final scores are returned
  for (let iter = 0; iter < maxIterations; iter++) {
    const next = new Map<string, number>();
    const vouchPropagated = new Map<string, number>();
    let maxDelta = 0;

    for (const uid of uids) {
      const edges = incoming.get(uid) ?? [];
      const propagated = edges.reduce((sum, e) => sum + e.weight * current.get(e.voucherId)!, 0);
      const score = clamp((1 - w) * earnedTrust.get(uid)! + w * propagated);

      next.set(uid, score);
      vouchPropagated.set(uid, w * propagated);
      maxDelta = Math.max(maxDelta, Math.abs(score - current.get(uid)!));
    }

    current = next;
    finalVouchPropagated = vouchPropagated;

    if (maxDelta < epsilon) break;
  }

  const results = new Map<string, VouchPropagationResult>();
  for (const uid of uids) {
    results.set(uid, {
      score: current.get(uid)!,
      vouchPropagated: finalVouchPropagated.get(uid) ?? 0,
    });
  }
  return results;
}

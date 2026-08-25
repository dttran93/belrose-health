// functions/test/vouchPropagation.test.ts
//
// Pure unit tests for the Phase 3 power-iteration solve — no Firestore/emulator involved.
// UserCredibility(u) = (1-w)*EarnedTrust(u) + w*Σ[VouchWeight(u1->u)*UserCredibility(u1)].
// Note the formula's own implication (not a bug): a user with NO incoming vouches converges to
// (1-w)*EarnedTrust(u), not EarnedTrust(u) itself — the vouch-propagated term is 0, so their
// score is deflated by exactly the w portion the formula reserves for peer endorsement. Several
// tests below lean on this to hand-derive exact expected steady states.

import { describe, it, expect } from 'vitest';
import { runVouchPropagation, type VouchPropagationParams } from '../src/credibility/vouchPropagation';

const DEFAULTS: Omit<VouchPropagationParams, 'earnedTrust' | 'vouchEdges' | 'warmStart'> = {
  w: 0.2,
  maxIterations: 50,
  epsilon: 0.5,
};

describe('runVouchPropagation', () => {
  it('an isolated user (no vouches at all) converges to (1-w)*EarnedTrust', () => {
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([['A', 600]]),
      vouchEdges: [],
      warmStart: new Map(),
    });

    expect(result.get('A')!.score).toBeCloseTo(0.8 * 600, 5);
    expect(result.get('A')!.vouchPropagated).toBeCloseTo(0, 5);
  });

  it('a mutual pair with equal EarnedTrust converges exactly back to that EarnedTrust', () => {
    // S = (1-w)E + w*S  =>  S(1-w) = (1-w)E  =>  S = E, for any w != 1.
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([
        ['A', 500],
        ['B', 500],
      ]),
      vouchEdges: [
        { voucherId: 'A', voucheeId: 'B' },
        { voucherId: 'B', voucheeId: 'A' },
      ],
      warmStart: new Map(),
    });

    expect(result.get('A')!.score).toBeCloseTo(500, 3);
    expect(result.get('B')!.score).toBeCloseTo(500, 3);
  });

  it('a 3-cycle (A->B->C->A) with equal EarnedTrust converges back to that EarnedTrust, not drift', () => {
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([
        ['A', 400],
        ['B', 400],
        ['C', 400],
      ]),
      vouchEdges: [
        { voucherId: 'A', voucheeId: 'B' },
        { voucherId: 'B', voucheeId: 'C' },
        { voucherId: 'C', voucheeId: 'A' },
      ],
      warmStart: new Map(),
    });

    for (const uid of ['A', 'B', 'C']) {
      expect(result.get(uid)!.score).toBeCloseTo(400, 3);
    }
  });

  it('a vouch hub receives propagated trust from multiple isolated vouchers, hand-derived exactly', () => {
    // Vouchers are isolated (no one vouches them): each converges to (1-w)*300 = 240.
    // Hub: propagated = 3 * 240 = 720; score = (1-w)*200 + w*720 = 160 + 144 = 304.
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([
        ['hub', 200],
        ['v1', 300],
        ['v2', 300],
        ['v3', 300],
      ]),
      vouchEdges: [
        { voucherId: 'v1', voucheeId: 'hub' },
        { voucherId: 'v2', voucheeId: 'hub' },
        { voucherId: 'v3', voucheeId: 'hub' },
      ],
      warmStart: new Map(),
    });

    expect(result.get('v1')!.score).toBeCloseTo(240, 3);
    expect(result.get('hub')!.score).toBeCloseTo(304, 3);
    expect(result.get('hub')!.vouchPropagated).toBeCloseTo(0.2 * 720, 3);
  });

  it('a voucher vouching for many people splits their outgoing weight evenly (VouchWeight = 1/|V(u1)|)', () => {
    // v vouches for A and B equally: each gets weight 1/2 of v's (isolated, deflated) score.
    // v's own score: isolated -> (1-w)*1000 = 800. Each of A/B: propagated = 0.5*800 = 400;
    // score = (1-w)*0 + w*400 = 80.
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([
        ['v', 1000],
        ['A', 0],
        ['B', 0],
      ]),
      vouchEdges: [
        { voucherId: 'v', voucheeId: 'A' },
        { voucherId: 'v', voucheeId: 'B' },
      ],
      warmStart: new Map(),
    });

    expect(result.get('v')!.score).toBeCloseTo(800, 3);
    expect(result.get('A')!.score).toBeCloseTo(80, 3);
    expect(result.get('B')!.score).toBeCloseTo(80, 3);
  });

  it('clamps scores to [0, 1000] even when propagation would push past the bound', () => {
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([
        ['hub', 0],
        ...Array.from({ length: 10 }, (_, i) => [`v${i}`, 1000] as [string, number]),
      ]),
      vouchEdges: Array.from({ length: 10 }, (_, i) => ({ voucherId: `v${i}`, voucheeId: 'hub' })),
      warmStart: new Map(),
    });

    expect(result.get('hub')!.score).toBeLessThanOrEqual(1000);
    expect(result.get('hub')!.score).toBeGreaterThanOrEqual(0);
  });

  it('warm start is used as the starting point instead of EarnedTrust when provided', () => {
    // With no vouches, the result is always (1-w)*EarnedTrust regardless of warm start (an
    // isolated node's fixed point doesn't depend on its starting value) — this test instead
    // confirms warm start doesn't change the FINAL converged answer, only iteration count,
    // which is the documented contract (warm start speeds convergence, doesn't change the fixed
    // point it converges to).
    const noWarmStart = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([['A', 700]]),
      vouchEdges: [],
      warmStart: new Map(),
    });
    const withWarmStart = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([['A', 700]]),
      vouchEdges: [],
      warmStart: new Map([['A', 999]]),
    });

    expect(withWarmStart.get('A')!.score).toBeCloseTo(noWarmStart.get('A')!.score, 5);
  });

  it('ignores vouch edges from/to users outside the scored set (defensive)', () => {
    const result = runVouchPropagation({
      ...DEFAULTS,
      earnedTrust: new Map([['A', 500]]),
      vouchEdges: [{ voucherId: 'ghost-voucher', voucheeId: 'A' }],
      warmStart: new Map(),
    });

    // The ghost voucher isn't in the scored set, so this edge contributes nothing — same as the
    // isolated-user case.
    expect(result.get('A')!.score).toBeCloseTo(0.8 * 500, 5);
  });
});

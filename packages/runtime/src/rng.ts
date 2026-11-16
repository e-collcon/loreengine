/**
 * The simulation's one random stream (spec 5.8): xoshiro128**, seeded
 * through SplitMix32 from a 32-bit seed. Its four-word state is saved.
 * Brains, `chance`, and spawns draw from it; presentation never does.
 */
export type RngState = [number, number, number, number];

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  /** Reseed through SplitMix32, which never yields the all-zero state xoshiro cannot leave. */
  seed(seed: number): void {
    let state = seed >>> 0;
    const next = (): number => {
      state = (state + 0x9e3779b9) >>> 0;
      let z = state;
      z ^= z >>> 16;
      z = Math.imul(z, 0x21f0aaad);
      z ^= z >>> 15;
      z = Math.imul(z, 0x735a2d97);
      z ^= z >>> 15;
      return z >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** The next 32-bit unsigned integer. */
  nextU32(): number {
    const r = Math.imul(this.s1, 5);
    const result = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = (this.s3 << 11) | (this.s3 >>> 21);
    return result;
  }

  /** A double in [0, 1). */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** An integer in [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.nextFloat() * n);
  }

  /** A double in [min, max). */
  range(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  getState(): RngState {
    return [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0];
  }

  setState(state: readonly number[]): void {
    this.s0 = state[0]! | 0;
    this.s1 = state[1]! | 0;
    this.s2 = state[2]! | 0;
    this.s3 = state[3]! | 0;
  }
}

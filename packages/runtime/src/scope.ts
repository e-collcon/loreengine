/**
 * Lifetimes (spec 5.5, 9.3). Everything that subscribes, schedules, or
 * caches does so under a scope. Disposing the scope releases it all; there
 * is no way to subscribe without one.
 */
export type ScopeKind = 'session' | 'map';

export class Scope {
  private disposers: (() => void)[] = [];
  private isDisposed = false;

  constructor(readonly kind: ScopeKind) {}

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Register cleanup to run when the scope is disposed. */
  own(disposer: () => void): void {
    if (this.isDisposed) throw new Error(`scope "${this.kind}" is already disposed`);
    this.disposers.push(disposer);
  }

  /** Release everything, newest first. Safe to call twice. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const disposers = this.disposers;
    this.disposers = [];
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]!();
  }
}

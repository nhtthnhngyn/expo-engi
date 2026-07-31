/**
 * Stable id assignment.
 *
 * Ids must be deterministic: the same ProseMirror document always yields the same ids, because
 * byte-identical output depends on it. Ids already present on a node are preserved untouched;
 * anything missing one gets the next sequential id in document order.
 */

export class IdAssigner {
  private counter = 0;
  private readonly seen = new Set<string>();

  constructor(private readonly prefix = 'b_') {}

  /** Returns the node's own id if it has one, otherwise the next generated id. */
  resolve(existing: unknown): string {
    if (typeof existing === 'string' && existing.length > 0) {
      this.seen.add(existing);
      return existing;
    }
    return this.next();
  }

  next(): string {
    let candidate: string;
    do {
      this.counter += 1;
      candidate = `${this.prefix}${String(this.counter).padStart(4, '0')}`;
    } while (this.seen.has(candidate));
    this.seen.add(candidate);
    return candidate;
  }
}

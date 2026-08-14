// A single-slot async mutex. All git-touching operations (write, delete, pull +
// their mirror) run through one shared instance so they never overlap on the one
// working clone, which would corrupt the git index. Operations are serialized in
// arrival order regardless of success or failure of the previous one.

export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    // Keep the chain going even if this operation rejects.
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

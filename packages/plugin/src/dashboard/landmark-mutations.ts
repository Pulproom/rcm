export class MemoryLandmarkPatchQueue<T> {
  readonly #tails = new Map<string, Promise<T[]>>();

  enqueue(
    memoryId: string,
    current: () => T[],
    mutate: (latest: T[]) => T[],
    save: (next: T[]) => Promise<void>,
  ): Promise<T[]> {
    const prior = this.#tails.get(memoryId);
    const operation = (prior ?? Promise.resolve().then(current)).catch(() => current()).then(async (latest) => {
      const next = mutate([...latest]);
      await save(next);
      // A refresh may have replaced the memory while the save was in flight.
      const saved = current();
      saved.splice(0, saved.length, ...next);
      return next;
    });
    this.#tails.set(memoryId, operation);
    void operation.finally(() => {
      if (this.#tails.get(memoryId) === operation) this.#tails.delete(memoryId);
    }).catch(() => undefined);
    return operation;
  }
}

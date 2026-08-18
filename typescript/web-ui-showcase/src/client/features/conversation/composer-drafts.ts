/** Draft storage shared by the resident Home and Session Composer variants. */
export class ComposerDrafts {
  readonly #values = new Map<string, string>();

  read(key: string): string {
    return this.#values.get(key) ?? "";
  }

  write(key: string, value: string): void {
    this.#values.set(key, value);
  }

  clear(key: string): void {
    this.#values.delete(key);
  }

  retain(keys: readonly string[]): void {
    const retained = new Set(keys);
    for (const key of this.#values.keys()) {
      if (!retained.has(key)) this.#values.delete(key);
    }
  }
}

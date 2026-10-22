/** Limits diagnostic retention by encoded size as well as entry count. */
export class ByteBoundedBuffer<T> {
  private readonly entries: Array<{ value: T; bytes: number }> = [];
  private bytes = 0;

  constructor(private readonly maxEntries: number, private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error("Buffer limits must be positive safe integers");
    }
  }

  get length(): number { return this.entries.length; }
  get retainedBytes(): number { return this.bytes; }

  push(value: T, bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error("Entry size must be a nonnegative safe integer");
    }
    if (bytes > this.maxBytes) return false;
    while (this.entries.length >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (removed) this.bytes -= removed.bytes;
    }
    this.entries.push({ value, bytes });
    this.bytes += bytes;
    return true;
  }

  values(): T[] { return this.entries.map((entry) => entry.value); }

  clear(): void {
    this.entries.length = 0;
    this.bytes = 0;
  }
}

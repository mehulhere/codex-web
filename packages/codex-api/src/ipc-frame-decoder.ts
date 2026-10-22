/** Decode fragmented IPC frames without repeatedly copying the accumulated body. */
export class IpcFrameDecoder {
  private readonly header = Buffer.alloc(4);
  private headerBytes = 0;
  private frameSize = 0;
  private bodyBytes = 0;
  private readonly fragments: Buffer[] = [];

  public constructor(private readonly maximumFrameBytes: number) {}

  public reset(): void {
    this.headerBytes = 0;
    this.frameSize = 0;
    this.bodyBytes = 0;
    this.fragments.length = 0;
  }

  public push(chunk: Buffer, onFrame: (payload: Buffer) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.headerBytes < 4) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        this.headerBytes += count;
        offset += count;
        if (this.headerBytes < 4) return;
        this.frameSize = this.header.readUInt32LE(0);
        if (this.frameSize > this.maximumFrameBytes) {
          throw new Error(`IPC frame exceeded limit (${this.frameSize} > ${this.maximumFrameBytes})`);
        }
      }

      const count = Math.min(this.frameSize - this.bodyBytes, chunk.length - offset);
      if (count > 0) {
        this.fragments.push(chunk.subarray(offset, offset + count));
        this.bodyBytes += count;
        offset += count;
      }
      if (this.bodyBytes < this.frameSize) return;

      const payload = this.fragments.length === 1
        ? this.fragments[0]!
        : Buffer.concat(this.fragments, this.frameSize);
      this.reset();
      onFrame(payload);
    }
  }
}

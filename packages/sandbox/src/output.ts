/** Default cap per stream; a sandboxed process must not be able to OOM the worker via stdout. */
export const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Accumulates a child stream up to a byte cap. Chunks past the cap are dropped (the stream
 * keeps draining so the child never blocks) and a single truncation marker is appended.
 * Decoding is streaming so multi-byte UTF-8 sequences split across chunks stay intact.
 */
export class BoundedOutput {
  private text = "";
  private bytes = 0;
  private truncated = false;
  private readonly decoder = new TextDecoder("utf-8");

  constructor(
    private readonly maxBytes: number,
    private readonly onChunk?: (chunk: string) => void,
  ) {}

  push(chunk: Buffer): void {
    if (this.truncated) return;
    let buf = chunk;
    if (this.bytes + buf.length > this.maxBytes) {
      buf = buf.subarray(0, Math.max(0, this.maxBytes - this.bytes));
      this.truncated = true;
    }
    this.bytes += buf.length;
    const decoded = this.decoder.decode(buf, { stream: !this.truncated });
    this.text += decoded;
    if (decoded) this.onChunk?.(decoded);
    if (this.truncated) {
      const marker = `\n[sdap-sandbox: output truncated at ${this.maxBytes} bytes]\n`;
      this.text += marker;
      this.onChunk?.(marker);
    }
  }

  value(): string {
    return this.text;
  }
}

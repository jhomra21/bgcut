/**
 * Per-subject tracking memory. Each instance owns a bounded chronological
 * window. Keeping it separate from the ONNX tensor assembly lets multiple
 * subjects have independent memories and lets rewind/reseed start cleanly.
 */
export class BoundedFrameMemory<T extends { readonly index: number }> {
  readonly #frames: T[] = [];
  readonly #capacity: number;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Frame memory capacity must be a positive safe integer.");
    }

    this.#capacity = capacity;
  }

  get size(): number {
    return this.#frames.length;
  }

  push(frame: T): void {
    const last = this.#frames.at(-1);

    if (!Number.isSafeInteger(frame.index) || frame.index < 0 ||
        (last !== undefined && frame.index <= last.index)) {
      throw new Error("Tracking memory frames must have strictly increasing indices.");
    }

    this.#frames.push(frame);

    if (this.#frames.length > this.#capacity) {
      this.#frames.shift();
    }
  }

  values(): readonly T[] {
    return [...this.#frames];
  }

  clear(): void {
    this.#frames.length = 0;
  }
}

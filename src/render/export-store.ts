import { randomUUID } from 'node:crypto';

/**
 * Short-lived, bounded in-memory store for generated documents, served back
 * through the `export://{id}` resource so large files travel as resource
 * links instead of flooding a tool result (and the model's context). Ids are
 * random UUIDs; nothing is written to disk.
 */

export interface StoredExport {
  id: string;
  filename: string;
  mimeType: string;
  /** Text documents (HTML) as string, binary (PDF) as Buffer. */
  data: string | Buffer;
  createdAt: number;
}

export class ExportStore {
  private readonly items = new Map<string, StoredExport>();

  constructor(
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maxItems = 32,
    private readonly maxBytes = 64 * 1024 * 1024,
    private readonly now: () => number = Date.now,
  ) {}

  put(filename: string, mimeType: string, data: string | Buffer): StoredExport {
    this.evict();
    const item: StoredExport = {
      id: randomUUID(),
      filename,
      mimeType,
      data,
      createdAt: this.now(),
    };
    this.items.set(item.id, item);
    this.evict();
    return item;
  }

  get(id: string): StoredExport | undefined {
    this.evict();
    return this.items.get(id);
  }

  get size(): number {
    return this.items.size;
  }

  private bytes(): number {
    let total = 0;
    for (const item of this.items.values()) total += Buffer.byteLength(item.data);
    return total;
  }

  private evict(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, item] of this.items) if (item.createdAt < cutoff) this.items.delete(id);
    // Oldest first (Map preserves insertion order).
    while (
      this.items.size > this.maxItems ||
      (this.items.size > 1 && this.bytes() > this.maxBytes)
    ) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }
}

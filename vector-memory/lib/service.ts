/**
 * Vector Memory Service
 *
 * A local vector database for storing and retrieving semantic memories.
 * Uses node:sqlite (built into Node 22+) for storage.
 */

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type {
  EmbeddingProvider,
  MemoryEntry,
  SearchResult,
  AddMemoryOptions,
  SearchOptions,
  MemoryCategory,
} from "./types.js";

const SCHEMA_VERSION = 1;
const VECTOR_DIMS = 768;

function vectorToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export class VectorMemoryService {
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private embeddingProvider: EmbeddingProvider;

  constructor(dbPath: string, embeddingProvider: EmbeddingProvider) {
    this.dbPath = dbPath.replace(/^~/, homedir());
    this.embeddingProvider = embeddingProvider;
  }

  async init(): Promise<void> {
    if (this.db) return;

    await mkdir(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.createSchema();
  }

  private createSchema(): void {
    const db = this.db!;

    db.exec(`
      CREATE TABLE IF NOT EXISTS vector_memory_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS vector_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        timestamp INTEGER NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        category TEXT NOT NULL DEFAULT 'fact',
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed INTEGER,
        related TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'unixepoch')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'unixepoch'))
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS vector_memory_embeddings (
        memory_id TEXT PRIMARY KEY,
        embedding BLOB,
        FOREIGN KEY (memory_id) REFERENCES vector_memories(id) ON DELETE CASCADE
      );
    `);

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vector_memory_fts USING fts5(
          content,
          id UNINDEXED,
          source UNINDEXED,
          category UNINDEXED
        );
      `);
    } catch {
      // FTS not available
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON vector_memories(timestamp);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memories_source ON vector_memories(source);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memories_category ON vector_memories(category);");

    db.prepare("INSERT OR IGNORE INTO vector_memory_meta (key, value) VALUES (?, ?)")
      .run("schema_version", String(SCHEMA_VERSION));
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async add(content: string, options: AddMemoryOptions = {}): Promise<{ id: string; isNew: boolean }> {
    await this.ensureInit();

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new Error("Content cannot be empty");
    }

    const existing = await this.findDuplicate(trimmedContent);
    if (existing) {
      return { id: existing.id, isNew: false };
    }

    const embedding = await this.embeddingProvider.embed(trimmedContent);
    const id = `mem_${randomBytes(16).toString("hex")}`;
    const timestamp = Date.now();
    const source = options.source ?? "manual";
    const category = options.category ?? this.inferCategory(trimmedContent);
    const importance = options.importance ?? this.calculateImportance(trimmedContent, category);
    const related = options.related ?? [];
    const now = Math.floor(Date.now() / 1000);

    this.db!.prepare(
      `INSERT INTO vector_memories (id, content, source, timestamp, importance, category, related, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, trimmedContent, source, timestamp, importance, category, JSON.stringify(related), now, now);

    this.db!.prepare("INSERT INTO vector_memory_embeddings (memory_id, embedding) VALUES (?, ?)")
      .run(id, vectorToBlob(embedding));

    try {
      const row = this.db!.prepare("SELECT rowid FROM vector_memories WHERE id = ?").get(id) as { rowid: number };
      this.db!.prepare("INSERT INTO vector_memory_fts (rowid, content, id, source, category) VALUES (?, ?, ?, ?, ?)")
        .run(row.rowid, trimmedContent, id, source, category);
    } catch {
      // FTS not available
    }

    return { id, isNew: true };
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.ensureInit();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0.1;
    const queryEmbedding = await this.embeddingProvider.embed(trimmedQuery);

    const memories = this.db!.prepare(`
      SELECT m.id, m.content, m.source, m.timestamp, m.importance, m.category,
             m.access_count, m.last_accessed, m.related,
             e.embedding
      FROM vector_memories m
      JOIN vector_memory_embeddings e ON m.id = e.memory_id
    `).all() as Array<{
      id: string;
      content: string;
      source: string;
      timestamp: number;
      importance: number;
      category: string;
      access_count: number;
      last_accessed: number | null;
      related: string;
      embedding: Buffer;
    }>;

    const results: SearchResult[] = [];
    for (const row of memories) {
      const embedding = this.blobToVector(row.embedding);
      if (!embedding) continue;

      const vectorScore = this.cosineSimilarity(queryEmbedding, embedding);
      if (vectorScore < minScore) continue;

      if (options.categories?.length && !options.categories.includes(row.category as MemoryCategory)) {
        continue;
      }

      results.push({
        memory: {
          id: row.id,
          content: row.content,
          source: row.source,
          timestamp: row.timestamp,
          importance: row.importance,
          category: row.category as MemoryCategory,
          accessCount: row.access_count,
          lastAccessed: row.last_accessed || 0,
          related: this.parseRelated(row.related),
        },
        score: vectorScore,
        vectorScore,
        keywordScore: 0,
      });
    }

    results.sort((a, b) => b.score - a.score);

    for (let i = 0; i < Math.min(limit, results.length); i++) {
      this.updateAccessStats(results[i].memory.id);
    }

    return results.slice(0, limit);
  }

  private async findDuplicate(content: string): Promise<MemoryEntry | null> {
    const embedding = await this.embeddingProvider.embed(content);

    const memories = this.db!.prepare(`
      SELECT m.id, m.content, m.source, m.timestamp, m.importance, m.category,
             m.access_count, m.last_accessed, m.related, e.embedding
      FROM vector_memories m
      JOIN vector_memory_embeddings e ON m.id = e.memory_id
    `).all() as Array<{
      id: string;
      content: string;
      source: string;
      timestamp: number;
      importance: number;
      category: string;
      access_count: number;
      last_accessed: number | null;
      related: string;
      embedding: Buffer;
    }>;

    for (const row of memories) {
      const storedEmbedding = this.blobToVector(row.embedding);
      if (!storedEmbedding) continue;

      const similarity = this.cosineSimilarity(embedding, storedEmbedding);
      if (similarity > 0.95) {
        return {
          id: row.id,
          content: row.content,
          source: row.source,
          timestamp: row.timestamp,
          importance: row.importance,
          category: row.category as MemoryCategory,
          accessCount: row.access_count,
          lastAccessed: row.last_accessed || 0,
          related: this.parseRelated(row.related),
        };
      }
    }

    return null;
  }

  private updateAccessStats(id: string): void {
    this.db!.prepare("UPDATE vector_memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  private parseRelated(json: string): string[] {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private blobToVector(blob: Buffer): number[] | null {
    if (!blob || blob.length < 4) return null;
    const arr = new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4);
    return Array.from(arr);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private inferCategory(content: string): MemoryCategory {
    const lower = content.toLowerCase();

    if (/^(decided|decision|will|going to)/i.test(content)) return "decision";
    if (/^(fix|fixed|corrected|bug fix|patch)/i.test(content)) return "fix";
    if (/^(correction|update|change)/i.test(content)) return "correction";
    if (/^(config|configuration|setting)/i.test(content)) return "config";
    if (/^(outcome|completed|finished|done)/i.test(content)) return "outcome";
    if (/^(process|workflow|pipeline|steps)/i.test(content)) return "process";
    return "fact";
  }

  private calculateImportance(content: string, category: MemoryCategory): number {
    const categoryImportance: Record<MemoryCategory, number> = {
      decision: 0.8,
      correction: 0.7,
      fix: 0.7,
      fact: 0.5,
      outcome: 0.6,
      process: 0.6,
      config: 0.4,
    };
    let score = categoryImportance[category] || 0.5;

    if (content.length > 200) score += 0.1;
    if (content.length > 500) score += 0.1;

    const importantKeywords = ["critical", "important", "must", "never", "always", "breaking"];
    const lowerContent = content.toLowerCase();
    for (const kw of importantKeywords) {
      if (lowerContent.includes(kw)) {
        score += 0.1;
        break;
      }
    }

    return Math.min(1, score);
  }

  private async ensureInit(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }
}

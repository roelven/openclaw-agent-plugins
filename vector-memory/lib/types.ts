/**
 * Vector Memory Plugin Types
 */

export interface VectorMemoryConfig {
  database: string;
  embedding: EmbeddingConfig;
  autoExtract: AutoExtractConfig;
  recall: RecallConfig;
}

export interface EmbeddingConfig {
  provider: "ollama";
  model: string;
  baseUrl: string;
}

export interface AutoExtractConfig {
  enabled: boolean;
  maxPerSession: number;
  minImportance: number;
}

export interface RecallConfig {
  enabled: boolean;
  limit: number;
  minScore: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  timestamp: number;
  importance: number;
  category: MemoryCategory;
  accessCount: number;
  lastAccessed: number;
  related: string[];
}

export type MemoryCategory =
  | "decision"
  | "correction"
  | "fix"
  | "fact"
  | "outcome"
  | "process"
  | "config";

export interface SearchResult {
  memory: MemoryEntry;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  checkHealth(): Promise<HealthCheckResult>;
}

export interface HealthCheckResult {
  available: boolean;
  modelAvailable?: boolean;
  error?: string;
}

export interface AddMemoryOptions {
  source?: string;
  category?: MemoryCategory;
  importance?: number;
  related?: string[];
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  categories?: MemoryCategory[];
}

export interface ExtractedFact {
  content: string;
  category: MemoryCategory;
  importance: number;
}

export interface ExtractionContext {
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  timestamp: number;
}

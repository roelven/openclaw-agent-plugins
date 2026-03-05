/**
 * Ollama Embedding Provider
 *
 * Provides vector embeddings using Ollama's nomic-embed-text model.
 */

import type { EmbeddingProvider, HealthCheckResult } from "./types.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
}

export function createOllamaEmbeddingProvider(
  config: OllamaProviderOptions,
): EmbeddingProvider {
  const baseUrl = config.baseUrl.replace(/\/v1\/?$/, "");

  return {
    async embed(text: string): Promise<number[]> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(`${baseUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.model, input: text }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Ollama error: ${response.status}`);
        }

        const data = await response.json() as { embedding?: number[]; embeddings?: number[][] };
        const embedding = data.embedding ?? data.embeddings?.[0];
        if (!Array.isArray(embedding)) {
          throw new Error("Invalid response from Ollama");
        }

        return normalize(embedding);
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async checkHealth(): Promise<HealthCheckResult> {
      try {
        const response = await fetch(`${baseUrl}/api/tags`);
        if (!response.ok) {
          return { available: true, modelAvailable: false, error: `Status ${response.status}` };
        }
        const data = await response.json() as { models: Array<{ name: string }> };
        const hasModel = (data.models ?? []).some((m) => m.name.startsWith(config.model));
        return { available: true, modelAvailable: hasModel };
      } catch {
        return { available: false, modelAvailable: false, error: "Cannot connect" };
      }
    },
  };
}

function normalize(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const mag = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (mag < 1e-10) return sanitized;
  return sanitized.map((v) => v / mag);
}

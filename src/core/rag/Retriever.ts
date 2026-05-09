/**
 * Retriever: Busca semântica por cosine similarity (SRP).
 *
 * Responsabilidade Única:
 * - Calcular similaridade entre vetores (cosine similarity)
 * - Filtrar por threshold
 * - Ordenar e retornar top-K
 *
 * Função pura — sem estado, sem I/O. Ideal para testes unitários.
 */

import type { ChunkEntry } from './VectorStore';

export interface SearchMatch {
  chunk: ChunkEntry;
  score: number; // 0.0 a 1.0
}

const SIMILARITY_THRESHOLD = 0.25;
const TOP_K = 5;

/**
 * Cosine Similarity — implementação nativa TypeScript.
 * cos(θ) = (A·B) / (||A|| × ||B||)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: ${a.length} vs ${b.length}. ` +
      `Ensure the embedding model is consistent.`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export class Retriever {
  /**
   * Busca os chunks mais similares a um vetor de consulta.
   *
   * @param queryEmbedding Vetor da consulta (384-dim)
   * @param chunks Lista de chunks candidatos
   * @returns Top-K matches ordenados por similaridade (decrescente)
   */
  retrieve(
    queryEmbedding: number[],
    chunks: ChunkEntry[]
  ): SearchMatch[] {
    const scored = chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    return scored
      .filter((s) => s.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
  }

  /**
   * Formata os matches em um bloco de contexto para o prompt.
   *
   * @param matches Resultados da busca
   * @param maxChars Limite de caracteres (padrão 4000)
   * @returns String formatada com citação de fonte [arquivo:linha]
   */
  formatContext(matches: SearchMatch[], maxChars: number = 4000): string {
    if (matches.length === 0) return '';

    let context = 'Documentos relevantes:\n\n';
    let used = context.length;

    for (const match of matches) {
      const header = `[${match.chunk.filePath}:${match.chunk.startLine}]`;
      const entry = `${header}\n${match.chunk.text}\n\n---\n\n`;

      if (used + entry.length > maxChars) {
        const remaining = maxChars - used;
        if (remaining > 100) {
          context += entry.slice(0, remaining) + '\n... [truncado]\n';
        }
        break;
      }

      context += entry;
      used += entry.length;
    }

    return context.trim();
  }
}
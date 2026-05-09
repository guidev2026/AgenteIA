import { describe, it, expect } from 'vitest';
import { cosineSimilarity, Retriever } from '../../../src/core/rag/Retriever';
import type { ChunkEntry } from '../../../src/core/rag/VectorStore';

/**
 * Testes unitários para Retriever e cosineSimilarity.
 *
 * Nenhuma dependência externa — funções matemáticas/transformação pura.
 * Zero consumo de CPU por Ollama, zero I/O.
 */

describe('cosineSimilarity()', () => {
  it('retorna 1.0 para vetores idênticos', () => {
    const a = [1.0, 0.0, 0.0];
    const b = [1.0, 0.0, 0.0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('retorna 0.0 para vetores ortogonais', () => {
    const a = [1.0, 0.0, 0.0];
    const b = [0.0, 1.0, 0.0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('retorna -1.0 para vetores opostos', () => {
    const a = [1.0, 0.0];
    const b = [-1.0, 0.0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('lança erro para dimensões diferentes', () => {
    const a = [1.0, 0.0];
    const b = [1.0];
    expect(() => cosineSimilarity(a, b)).toThrow(/Dimension mismatch/);
  });

  it('retorna 0 quando denominador é zero (vetor nulo)', () => {
    const a = [0.0, 0.0, 0.0];
    const b = [1.0, 2.0, 3.0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('retorna 0 quando ambos vetores são nulos', () => {
    const a = [0.0, 0.0];
    const b = [0.0, 0.0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('calcula corretamente para valores fracionários', () => {
    const a = [0.5, 0.5];
    const b = [0.5, 0.5];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });
});

describe('Retriever.retrieve()', () => {
  const mockDim = 384;

  function unitVector(index: number): number[] {
    const v = new Array(mockDim).fill(0);
    v[index] = 1.0;
    return v;
  }

  const chunks: ChunkEntry[] = [
    { id: 'c0', text: 'zero', filePath: 'a.ts', startLine: 1, endLine: 2, embedding: unitVector(0), indexedAt: Date.now() },
    { id: 'c1', text: 'um', filePath: 'a.ts', startLine: 3, endLine: 4, embedding: unitVector(1), indexedAt: Date.now() },
    { id: 'c2', text: 'dois', filePath: 'a.ts', startLine: 5, endLine: 6, embedding: unitVector(2), indexedAt: Date.now() },
    { id: 'c3', text: 'tres', filePath: 'a.ts', startLine: 7, endLine: 8, embedding: unitVector(3), indexedAt: Date.now() },
    { id: 'c4', text: 'quatro', filePath: 'a.ts', startLine: 9, endLine: 10, embedding: unitVector(4), indexedAt: Date.now() },
    { id: 'c5', text: 'cinco', filePath: 'a.ts', startLine: 11, endLine: 12, embedding: unitVector(5), indexedAt: Date.now() },
    { id: 'c6', text: 'seis', filePath: 'a.ts', startLine: 13, endLine: 14, embedding: unitVector(6), indexedAt: Date.now() },
    { id: 'c7', text: 'sete', filePath: 'a.ts', startLine: 15, endLine: 16, embedding: unitVector(7), indexedAt: Date.now() },
    { id: 'c8', text: 'oito', filePath: 'a.ts', startLine: 17, endLine: 18, embedding: unitVector(8), indexedAt: Date.now() },
    { id: 'c9', text: 'nove', filePath: 'a.ts', startLine: 19, endLine: 20, embedding: unitVector(9), indexedAt: Date.now() },
  ];

  const retriever = new Retriever();

  it('retorna top-5 chunks ordenados por similaridade (score decrescente)', () => {
    const query = new Array(mockDim).fill(0);
    query[0] = 1.0;
    query[1] = 0.8;
    query[2] = 0.6;
    query[3] = 0.4;

    const results = retriever.retrieve(query, chunks);

    expect(results).toHaveLength(4);
    expect(results[0].chunk.id).toBe('c0');
    expect(results[1].chunk.id).toBe('c1');
    expect(results[2].chunk.id).toBe('c2');
    expect(results[3].chunk.id).toBe('c3');
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThan(results[i - 1].score);
    }
  });

  it('filtra chunks abaixo do threshold (0.25)', () => {
    const query = unitVector(0);
    const results = retriever.retrieve(query, chunks);
    expect(results).toHaveLength(1);
    expect(results[0].chunk.id).toBe('c0');
  });

  it('retorna array vazio para lista vazia de chunks', () => {
    const results = retriever.retrieve(unitVector(0), []);
    expect(results).toEqual([]);
  });
});

describe('Retriever.formatContext()', () => {
  const retriever = new Retriever();

  it('retorna string vazia para matches vazio', () => {
    expect(retriever.formatContext([])).toBe('');
  });

  it('formata matches com citação [arquivo:linha]', () => {
    const matches = [{
      chunk: { id: 'c0', text: 'conteudo exemplo', filePath: 'src/test.ts', startLine: 10, endLine: 15, embedding: [1, 0, 0], indexedAt: Date.now() },
      score: 0.95,
    }];

    const result = retriever.formatContext(matches);
    expect(result).toContain('[src/test.ts:10]');
    expect(result).toContain('conteudo exemplo');
  });

  it('trunca se exceder maxChars', () => {
    const longText = 'A'.repeat(500);
    const matches = [{
      chunk: { id: 'c0', text: longText, filePath: 'big.ts', startLine: 1, endLine: 10, embedding: [1, 0, 0], indexedAt: Date.now() },
      score: 0.99,
    }];

    const result = retriever.formatContext(matches, 200);
    expect(result).toContain('[truncado]');
    // O prefixo "Documentos relevantes:\n\n" é adicionado antes do truncamento
    // então o tamanho pode passar ligeiramente de 200, mas deve ficar abaixo do texto completo
    expect(result.length).toBeLessThan(longText.length);
  });
});
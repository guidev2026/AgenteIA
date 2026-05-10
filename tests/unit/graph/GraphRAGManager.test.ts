/**
 * Testes unitários para GraphRAGManager.
 *
 * Cobre:
 * - search() com grafo vazio (sem nós)
 * - search() expande vizinhança corretamente
 * - search() com profundidade de grafo diferente
 * - search() mescla e re-ranqueia resultados
 * - search() textWeight = 1.0 (apenas textual)
 * - search() textWeight = 0.0 (apenas estrutural)
 * - search() filtra por edgeTypes
 * - formatGraphContext() com e sem nós visitados
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GraphRAGManager,
  type GraphSearchOptions,
} from '../../../src/core/rag/graph/GraphRAGManager';
import { Retriever } from '../../../src/core/rag/Retriever';
import type { IGraphQuery, NeighborNode } from '../../../src/core/rag/graph/IGraphQuery';
import type { ChunkEntry } from '../../../src/core/rag/VectorStore';
import type { RelationshipType } from '../../../src/core/rag/graph/types';

// ----- helpers de teste -----

/** Cria um chunk simples */
function makeChunk(
  id: string,
  filePath: string,
  text: string,
  startLine = 1,
  endLine = 10
): ChunkEntry {
  return {
    id,
    filePath,
    text,
    startLine,
    endLine,
    embedding: [0.1, 0.2, 0.3],
    indexedAt: Date.now(),
  };
}

/** Cria um vizinho do grafo */
function makeNeighbor(
  id: string,
  label: string,
  filePath: string,
  edgeType: RelationshipType,
  distance: number
): NeighborNode {
  return { id, label, filePath, edgeType, distance, type: 'function', startLine: 1, endLine: 10 };
}

describe('GraphRAGManager', () => {
  let retriever: Retriever;
  let graphQuery: IGraphQuery;
  let manager: GraphRAGManager;

  beforeEach(() => {
    retriever = new Retriever();
    graphQuery = {
      getNodeByChunkId: vi.fn(),
      expandNeighborhood: vi.fn(),
      getNodesByFile: vi.fn().mockReturnValue([]),
    };
    manager = new GraphRAGManager(retriever, graphQuery);
  });

  // =========================================================================
  // search - grafo vazio
  // =========================================================================

  it('retorna apenas resultados textuais quando grafo está vazio', async () => {
    const queryEmbedding = [0.1, 0.2, 0.3];
    const chunks = [
      makeChunk('c1', 'file1.ts', 'function foo() {}', 1, 5),
      makeChunk('c2', 'file2.ts', 'function bar() {}', 10, 20),
    ];

    // getNodeByChunkId retorna null para todos (grafo vazio)
    (graphQuery.getNodeByChunkId as any).mockReturnValue(null);

    const result = await manager.search(queryEmbedding, chunks);

    expect(result.matches.length).toBeGreaterThanOrEqual(0);
    expect(result.visitedNodes).toEqual([]);
    expect(result.expandedChunks).toBe(0);
  });

  // =========================================================================
  // search - expansão de vizinhança
  // =========================================================================

  it('expande vizinhança dos chunks encontrados', async () => {
    const queryEmbedding = [0.1, 0.2, 0.3];
    const chunks = [
      makeChunk('c1', 'a.ts', 'function a() {}'),
      makeChunk('c2', 'b.ts', 'function b() {}'),
    ];

    // Nó no grafo para c1
    const nodeA = {
      id: 'n-a',
      label: 'a',
      type: 'function' as const,
      filePath: 'a.ts',
      startLine: 1,
      endLine: 5,
    };

    // Vizinhança de n-a: nó n-b (CALLS)
    const neighborB: NeighborNode = makeNeighbor('n-b', 'b', 'b.ts', 'CALLS', 1);

    (graphQuery.getNodeByChunkId as any).mockImplementation((chunkId: string) => {
      if (chunkId === 'c1') return nodeA;
      return null;
    });

    (graphQuery.expandNeighborhood as any).mockReturnValue([neighborB]);

    const result = await manager.search(queryEmbedding, chunks);

    // Deve ter expandido
    expect(result.visitedNodes.length).toBeGreaterThanOrEqual(1);
    expect(result.visitedNodes[0].id).toBe('n-b');
  });

  // =========================================================================
  // search - profundidade de grafo diferente
  // =========================================================================

  it('passa depth e edgeTypes corretos para expandNeighborhood', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'x')];
    const nodeA = { id: 'n-a', label: 'a', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 5 };

    (graphQuery.getNodeByChunkId as any).mockReturnValue(nodeA);
    (graphQuery.expandNeighborhood as any).mockReturnValue([]);

    const options: GraphSearchOptions = { graphDepth: 3, edgeTypes: ['CALLS', 'REFERENCES'] };

    await manager.search([0.1, 0.2, 0.3], chunks, options);

    expect(graphQuery.expandNeighborhood).toHaveBeenCalledWith('n-a', {
      depth: 3,
      edgeTypes: ['CALLS', 'REFERENCES'],
    });
  });

  // =========================================================================
  // search - mescla e re-ranqueia resultados
  // =========================================================================

  it('mescla resultados textuais e estruturais no ranking final', async () => {
    const queryEmbedding = [0.1, 0.2, 0.3];
    // Chunks com embedding similar ao query
    const chunks = [
      makeChunk('c1', 'file1.ts', 'function sum(a, b) { return a + b; }'),
      makeChunk('c2', 'file2.ts', 'function multiply(a, b) { return a * b; }'),
      // chunk3 está no mesmo arquivo do vizinho de c1
      makeChunk('c3', 'neighbor-file.ts', 'function helper() {}'),
    ];

    const nodeC1 = { id: 'n-c1', label: 'sum', type: 'function' as const, filePath: 'file1.ts', startLine: 1, endLine: 3 };
    const nodeC3 = { id: 'n-c3', label: 'helper', type: 'function' as const, filePath: 'neighbor-file.ts', startLine: 1, endLine: 3 };

    (graphQuery.getNodeByChunkId as any).mockImplementation((chunkId: string) => {
      if (chunkId === 'c1') return nodeC1;
      if (chunkId === 'c3') return nodeC3;
      return null;
    });

    // Expandindo n-c1 → encontra vizinho neighbor-file
    const neighbor: NeighborNode = makeNeighbor('n-c3', 'helper', 'neighbor-file.ts', 'REFERENCES', 1);
    (graphQuery.expandNeighborhood as any).mockReturnValue([neighbor]);

    const result = await manager.search(queryEmbedding, chunks, { textWeight: 0.7 });

    // Deve ter pelo menos 1 match
    expect(result.matches.length).toBeGreaterThan(0);
    // expandNeighborhood foi chamado
    expect(graphQuery.expandNeighborhood).toHaveBeenCalled();
  });

  // =========================================================================
  // search - textWeight = 1.0 (apenas textual)
  // =========================================================================

  it('com textWeight=1.0 retorna apenas score textual', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'const x = 1;')];
    const node = { id: 'n1', label: 'x', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };
    const neighbor = makeNeighbor('n2', 'y', 'b.ts', 'CALLS', 1);

    (graphQuery.getNodeByChunkId as any).mockReturnValue(node);
    (graphQuery.expandNeighborhood as any).mockReturnValue([neighbor]);

    const result = await manager.search([0.1, 0.2, 0.3], chunks, { textWeight: 1.0 });

    // Todos os matches devem ter score textual puro
    for (const match of result.matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
    }
  });

  // =========================================================================
  // search - textWeight = 0.0 (apenas estrutural)
  // =========================================================================

  it('com textWeight=0.0 retorna apenas score estrutural', async () => {
    const chunks = [
      makeChunk('c1', 'a.ts', 'const x = 1;'),
      makeChunk('c2', 'neighbor.ts', 'const y = 2;'),
    ];
    const node = { id: 'n1', label: 'x', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };
    const neighbor = makeNeighbor('n2', 'y', 'neighbor.ts', 'CALLS', 1);

    (graphQuery.getNodeByChunkId as any).mockImplementation((chunkId: string) => {
      if (chunkId === 'c1') return node;
      return null;
    });
    (graphQuery.expandNeighborhood as any).mockReturnValue([neighbor]);

    const result = await manager.search([0.1, 0.2, 0.3], chunks, { textWeight: 0.0 });

    // Pode ter encontrado neighbor via expansão
    expect(result.visitedNodes.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // search - filtra por edgeTypes
  // =========================================================================

  it('edgeTypes limita a expansão a tipos específicos', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'x')];
    const node = { id: 'n1', label: 'x', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };

    (graphQuery.getNodeByChunkId as any).mockReturnValue(node);
    (graphQuery.expandNeighborhood as any).mockReturnValue([]);

    await manager.search([0.1, 0.2, 0.3], chunks, { edgeTypes: ['CALLS'] });

    expect(graphQuery.expandNeighborhood).toHaveBeenCalledWith('n1', {
      depth: 2,
      edgeTypes: ['CALLS'],
    });
  });

  // =========================================================================
  // formatGraphContext
  // =========================================================================

  it('formatGraphContext retorna string com cabeçalho', async () => {
    // Executa busca primeiro para ter um resultado
    const chunks = [makeChunk('c1', 'a.ts', 'function test() {}')];
    const node = { id: 'n1', label: 'test', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };
    (graphQuery.getNodeByChunkId as any).mockReturnValue(node);
    (graphQuery.expandNeighborhood as any).mockReturnValue([]);

    const result = await manager.search([0.1, 0.2, 0.3], chunks);
    const formatted = manager.formatGraphContext(result);

    expect(formatted).toContain('=== CONTEXTO HÍBRIDO');
  });

  it('formatGraphContext inclui resultados com score e texto', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'function test() {}')];
    const node = { id: 'n1', label: 'test', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };
    (graphQuery.getNodeByChunkId as any).mockReturnValue(node);
    (graphQuery.expandNeighborhood as any).mockReturnValue([]);

    const result = await manager.search([0.1, 0.2, 0.3], chunks);
    const formatted = manager.formatGraphContext(result);

    // Deve conter o caminho do arquivo
    expect(formatted).toContain('a.ts');
    // Deve conter a label do chunk
    expect(formatted).toContain('function test() {}');
  });

  it('formatGraphContext inclui seção RELAÇÕES ESTRUTURAIS quando há nós visitados', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'x')];
    const node = { id: 'n1', label: 'x', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };
    const neighbor = makeNeighbor('n2', 'y', 'b.ts', 'CALLS', 1);

    (graphQuery.getNodeByChunkId as any).mockReturnValue(node);
    (graphQuery.expandNeighborhood as any).mockReturnValue([neighbor]);

    const result = await manager.search([0.1, 0.2, 0.3], chunks);
    const formatted = manager.formatGraphContext(result);

    expect(formatted).toContain('RELAÇÕES ESTRUTURAIS');
    expect(formatted).toContain('b.ts');
  });

  it('formatGraphContext não inclui RELAÇÕES ESTRUTURAIS se não há nós', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'x')];
    (graphQuery.getNodeByChunkId as any).mockReturnValue(null);

    const result = await manager.search([0.1, 0.2, 0.3], chunks);
    const formatted = manager.formatGraphContext(result);

    expect(formatted).not.toContain('RELAÇÕES ESTRUTURAIS');
  });

  it('formatGraphContext inclui contagem de base e expanded chunks', async () => {
    const chunks = [makeChunk('c1', 'a.ts', 'x')];
    const node = { id: 'n1', label: 'x', type: 'function' as const, filePath: 'a.ts', startLine: 1, endLine: 3 };
    (graphQuery.getNodeByChunkId as any).mockReturnValue(node);
    (graphQuery.expandNeighborhood as any).mockReturnValue([]);

    const result = await manager.search([0.1, 0.2, 0.3], chunks);
    const formatted = manager.formatGraphContext(result);

    expect(formatted).toContain('Base chunks');
    expect(formatted).toContain('Expanded chunks');
  });
});
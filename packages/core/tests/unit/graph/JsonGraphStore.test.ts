/**
 * Testes unitários para JsonGraphStore.
 *
 * Cobre:
 * - save(), load(), clear()
 * - upsertNodes(), upsertEdges()
 * - getNodeByChunkId(), expandNeighborhood(), getNodesByFile()
 * - Idempotência de upserts (chave composta)
 * - Grafo não carregado (adjacency = null)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { JsonGraphStore, hashId } from '../../../src/core/rag/graph/JsonGraphStore';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '../../../src/core/rag/graph/types';

/**
 * Cria um diretório temporário isolado para cada teste.
 * Garante zero efeito colateral entre testes.
 */
function createTempDir(): string {
  return fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'));
}

describe('JsonGraphStore', () => {
  let store: JsonGraphStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    store = new JsonGraphStore(tempDir);
  });

  afterEach(async () => {
    await store.clear();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // save / load / clear
  // =========================================================================

  it('salva e carrega o grafo completo', async () => {
    const now = new Date().toISOString();
    const graph: KnowledgeGraph = {
      version: 1,
      nodes: [
        {
          id: 'abc',
          label: 'testFunc',
          type: 'function',
          filePath: 'src/test.ts',
          startLine: 1,
          endLine: 10,
        },
      ],
      edges: [],
      fileMtimes: {},
      createdAt: now,
      updatedAt: now,
    };

    await store.save(graph);
    const loaded = await store.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.nodes).toHaveLength(1);
    expect(loaded!.nodes[0].label).toBe('testFunc');
    expect(loaded!.version).toBe(1);
    expect(loaded!.createdAt).toBe(now);
  });

  it('retorna null no load se o arquivo não existe', async () => {
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it('remove o arquivo no clear', async () => {
    const graph: KnowledgeGraph = {
      version: 1, nodes: [], edges: [],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);
    await store.clear();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it('clear não lança erro se arquivo não existe', async () => {
    await expect(store.clear()).resolves.toBeUndefined();
  });

  // =========================================================================
  // upsertNodes
  // =========================================================================

  it('insere nós via upsertNodes', async () => {
    const node: GraphNode = {
      id: 'n1',
      label: 'funcA',
      type: 'function',
      filePath: 'a.ts',
      startLine: 1,
      endLine: 5,
    };

    await store.upsertNodes([node]);
    const loaded = await store.load();
    expect(loaded!.nodes).toHaveLength(1);
    expect(loaded!.nodes[0].id).toBe('n1');
  });

  it('substitui nó existente com o mesmo id no upsertNodes', async () => {
    const node1: GraphNode = { id: 'n1', label: 'old', type: 'function', filePath: 'a.ts', startLine: 1, endLine: 5 };
    const node2: GraphNode = { id: 'n1', label: 'new', type: 'function', filePath: 'a.ts', startLine: 6, endLine: 10 };

    await store.upsertNodes([node1]);
    await store.upsertNodes([node2]);

    const loaded = await store.load();
    expect(loaded!.nodes).toHaveLength(1);
    expect(loaded!.nodes[0].label).toBe('new');
  });

  // =========================================================================
  // upsertEdges
  // =========================================================================

  it('insere arestas via upsertEdges', async () => {
    const edge: GraphEdge = {
      from: 'n1',
      to: 'n2',
      type: 'CALLS',
    };

    await store.upsertEdges([edge]);
    const loaded = await store.load();
    expect(loaded!.edges).toHaveLength(1);
    expect(loaded!.edges[0].type).toBe('CALLS');
  });

  it('deduplica arestas pela chave composta from|to|type', async () => {
    const edge: GraphEdge = { from: 'n1', to: 'n2', type: 'CALLS' };

    await store.upsertEdges([edge]);
    await store.upsertEdges([edge]); // mesmo exato

    const loaded = await store.load();
    expect(loaded!.edges).toHaveLength(1);
  });

  it('permite arestas com from|to diferentes', async () => {
    await store.upsertEdges([
      { from: 'n1', to: 'n2', type: 'CALLS' },
      { from: 'n1', to: 'n3', type: 'REFERENCES' },
    ]);

    const loaded = await store.load();
    expect(loaded!.edges).toHaveLength(2);
  });

  // =========================================================================
  // IGraphQuery - getNodeByChunkId
  // =========================================================================

  it('retorna nulo se grafo não carregado', () => {
    expect(store.getNodeByChunkId('any')).toBeNull();
  });

  it('retorna nó pelo chunkId', async () => {
    const node: GraphNode = {
      id: 'n1',
      label: 'func',
      type: 'function',
      chunkId: 'chunk-001',
      filePath: 'a.ts',
      startLine: 1,
      endLine: 5,
    };

    const graph: KnowledgeGraph = {
      version: 1, nodes: [node], edges: [],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    const found = store.getNodeByChunkId('chunk-001');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('n1');
  });

  it('retorna nulo se chunkId não existe', async () => {
    const node: GraphNode = {
      id: 'n1', label: 'func', type: 'function',
      filePath: 'a.ts', startLine: 1, endLine: 5,
    };
    const graph: KnowledgeGraph = {
      version: 1, nodes: [node], edges: [],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    expect(store.getNodeByChunkId('inexistente')).toBeNull();
  });

  // =========================================================================
  // IGraphQuery - expandNeighborhood
  // =========================================================================

  it('expande vizinhança direta (depth=1)', async () => {
    const nodeA: GraphNode = { id: 'a', label: 'A', type: 'function', filePath: 'f.ts', startLine: 1, endLine: 3 };
    const nodeB: GraphNode = { id: 'b', label: 'B', type: 'function', filePath: 'f.ts', startLine: 5, endLine: 7 };

    const graph: KnowledgeGraph = {
      version: 1, nodes: [nodeA, nodeB],
      edges: [{ from: 'a', to: 'b', type: 'CALLS' }],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    const neighbors = store.expandNeighborhood('a', { depth: 1 });
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].id).toBe('b');
    expect(neighbors[0].edgeType).toBe('CALLS');
    expect(neighbors[0].distance).toBe(1);
  });

  it('expande vizinhança em profundidade (depth=2)', async () => {
    // a -> b -> c
    const nodeA: GraphNode = { id: 'a', label: 'A', type: 'function', filePath: 'f.ts', startLine: 1, endLine: 3 };
    const nodeB: GraphNode = { id: 'b', label: 'B', type: 'function', filePath: 'f.ts', startLine: 5, endLine: 7 };
    const nodeC: GraphNode = { id: 'c', label: 'C', type: 'function', filePath: 'f.ts', startLine: 9, endLine: 11 };

    const graph: KnowledgeGraph = {
      version: 1, nodes: [nodeA, nodeB, nodeC],
      edges: [
        { from: 'a', to: 'b', type: 'CALLS' },
        { from: 'b', to: 'c', type: 'REFERENCES' },
      ],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    const neighbors = store.expandNeighborhood('a', { depth: 2 });
    expect(neighbors).toHaveLength(2);

    const b = neighbors.find((n) => n.id === 'b');
    const c = neighbors.find((n) => n.id === 'c');
    expect(b).toBeDefined();
    expect(b!.distance).toBe(1);
    expect(c).toBeDefined();
    expect(c!.distance).toBe(2);
  });

  it('filtra por tipo de aresta', async () => {
    const nodeA: GraphNode = { id: 'a', label: 'A', type: 'function', filePath: 'f.ts', startLine: 1, endLine: 3 };
    const nodeB: GraphNode = { id: 'b', label: 'B', type: 'function', filePath: 'f.ts', startLine: 5, endLine: 7 };
    const nodeC: GraphNode = { id: 'c', label: 'C', type: 'function', filePath: 'f.ts', startLine: 9, endLine: 11 };

    const graph: KnowledgeGraph = {
      version: 1, nodes: [nodeA, nodeB, nodeC],
      edges: [
        { from: 'a', to: 'b', type: 'CALLS' },
        { from: 'a', to: 'c', type: 'REFERENCES' },
      ],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    const neighbors = store.expandNeighborhood('a', { depth: 1, edgeTypes: ['CALLS'] });
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].id).toBe('b');
  });

  it('retorna array vazio se grafo não carregado', () => {
    const result = store.expandNeighborhood('a', { depth: 1 });
    expect(result).toEqual([]);
  });

  // =========================================================================
  // IGraphQuery - getNodesByFile
  // =========================================================================

  it('retorna nós de um arquivo específico', async () => {
    const nodeA: GraphNode = { id: 'a', label: 'A', type: 'function', filePath: 'f.ts', startLine: 1, endLine: 3 };
    const nodeB: GraphNode = { id: 'b', label: 'B', type: 'function', filePath: 'f.ts', startLine: 5, endLine: 7 };
    const nodeC: GraphNode = { id: 'c', label: 'C', type: 'function', filePath: 'g.ts', startLine: 1, endLine: 3 };

    const graph: KnowledgeGraph = {
      version: 1, nodes: [nodeA, nodeB, nodeC], edges: [],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    const fileNodes = store.getNodesByFile('f.ts');
    expect(fileNodes).toHaveLength(2);
    expect(fileNodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('retorna array vazio para arquivo sem nós', async () => {
    const graph: KnowledgeGraph = {
      version: 1, nodes: [], edges: [],
      fileMtimes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.save(graph);

    expect(store.getNodesByFile('x.ts')).toEqual([]);
  });

  it('retorna array vazio se grafo não carregado', () => {
    expect(store.getNodesByFile('f.ts')).toEqual([]);
  });

  // =========================================================================
  // hashId
  // =========================================================================

  it('hashId gera strings consistentes e únicas', () => {
    const h1 = hashId('src/test.ts');
    const h2 = hashId('src/test.ts');
    const h3 = hashId('src/other.ts');

    expect(h1).toBe(h2);   // determinístico
    expect(h1).not.toBe(h3); // entradas diferentes → hashes diferentes
    expect(h1).toHaveLength(12);
    expect(h3).toHaveLength(12);
  });
});
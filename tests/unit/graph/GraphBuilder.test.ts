/**
 * Testes unitários para GraphBuilder.
 *
 * Cobre:
 * - build() com diretório vazio (sem arquivos)
 * - build() com arquivos .ts e .js
 * - build() incremental (arquivos não modificados são ignorados)
 * - build() detecta arquivos removidos
 * - build() respeita maxFiles
 * - build() ignora node_modules, .git, .soberano, dist
 * - Erro ao ler arquivo não interrompe o processo
 * - Reload do grafo existente
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphBuilder } from '../../../src/core/rag/graph/GraphBuilder';
import type { IRelationshipExtractor } from '../../../src/core/rag/graph/IRelationshipExtractor';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '../../../src/core/rag/graph/types';

// ----- Mocks globais do fs para evitar tocar no disco real -----
vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readdir: vi.fn(),
  },
  stat: vi.fn(),
  readdir: vi.fn(),
}));

/**
 * Mock do FileReader: retorna conteúdo arbitrário ou diretório.
 */
function createMockFileReader() {
  return {
    readFile: vi.fn(),
    readDir: vi.fn(),
    searchFiles: vi.fn(),
  };
}

/**
 * Mock do IGraphStore.
 */
function createMockGraphStore() {
  let stored: KnowledgeGraph | null = null;
  return {
    load: vi.fn(async () => stored),
    save: vi.fn(async (graph: KnowledgeGraph) => {
      stored = graph;
    }),
    clear: vi.fn(),
    upsertNodes: vi.fn(),
    upsertEdges: vi.fn(),
  };
}

/**
 * Helper para criar um nó de grafo.
 */
function makeNode(id: string, label: string, filePath: string, type: GraphNode['type'] = 'function'): GraphNode {
  return { id, label, type, filePath, startLine: 1, endLine: 10 };
}

/**
 * Helper para criar uma aresta.
 */
function makeEdge(from: string, to: string, type: GraphEdge['type'] = 'CALLS'): GraphEdge {
  return { from, to, type };
}

describe('GraphBuilder', () => {
  let mockFileReader: ReturnType<typeof createMockFileReader>;
  let mockExtractor: IRelationshipExtractor;
  let mockStore: ReturnType<typeof createMockGraphStore>;
  let builder: GraphBuilder;
  let fsMock: { stat: ReturnType<typeof vi.fn>; readdir: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Reseta mocks do fs
    const fs = await import('node:fs/promises');
    fsMock = fs as any;
    vi.clearAllMocks();

    mockFileReader = createMockFileReader();
    mockExtractor = { extract: vi.fn() };
    mockStore = createMockGraphStore();
    builder = new GraphBuilder(mockFileReader as any, mockExtractor, mockStore as any);
  });

  // =========================================================================
  // build - diretório vazio
  // =========================================================================

  it('retorna resultado vazio para diretório sem arquivos', async () => {
    mockFileReader.readDir.mockResolvedValue([]);

    const result = await builder.build({ rootDir: '/tmp/proj' });

    expect(result.filesProcessed).toBe(0);
    expect(result.totalNodes).toBe(0);
    expect(result.totalEdges).toBe(0);
    expect(result.rebuilt).toBe(false);
  });

  // =========================================================================
  // build - com arquivos fonte
  // =========================================================================

  it('processa arquivos .ts e .js e constrói o grafo', async () => {
    // readDir do FileReader retorna lista de entradas
    mockFileReader.readDir.mockResolvedValue(['index.ts']);
    // fs.stat retorna que é um arquivo .ts
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 1000 });

    mockFileReader.readFile.mockResolvedValue('class ServiceA {}\nfunction helper() {}');

    mockExtractor.extract = vi.fn().mockReturnValue({
      nodes: [
        makeNode('node-service-a', 'ServiceA', 'index.ts'),
        makeNode('node-helper', 'helper', 'index.ts'),
      ],
      edges: [
        makeEdge('node-service-a', 'node-helper', 'REFERENCES'),
      ],
    });

    const result = await builder.build({
      rootDir: '/tmp/proj',
      maxFiles: 100,
    });

    expect(mockStore.save).toHaveBeenCalledTimes(1);
    const savedGraph = mockStore.save.mock.calls[0][0] as KnowledgeGraph;
    expect(savedGraph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(savedGraph.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('processa extensões .tsx, .jsx, .mjs, .cjs', async () => {
    const files = ['Component.tsx', 'utils.js', 'helper.mjs', 'config.cjs'];
    mockFileReader.readDir.mockResolvedValue(files);
    // Cada entrada é um arquivo (não diretório)
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 1000 });
    mockFileReader.readFile.mockResolvedValue('const x = 1;');
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n1', 'x', 'file.ts')], edges: [] });

    const result = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });

    expect(mockExtractor.extract).toHaveBeenCalledWith('Component.tsx', expect.any(String));
    expect(mockExtractor.extract).toHaveBeenCalledWith('utils.js', expect.any(String));
    expect(mockExtractor.extract).toHaveBeenCalledWith('helper.mjs', expect.any(String));
    expect(mockExtractor.extract).toHaveBeenCalledWith('config.cjs', expect.any(String));
    expect(result.filesProcessed).toBe(4);
  });

  // =========================================================================
  // build - incremental (arquivos não modificados)
  // =========================================================================

  it('ignora arquivos não modificados (mtime igual)', async () => {
    const existingGraph: KnowledgeGraph = {
      version: 1,
      nodes: [makeNode('n1', 'existingFunc', 'file.ts')],
      edges: [],
      fileMtimes: { 'file.ts': 1000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockStore.load.mockResolvedValue(existingGraph);
    mockFileReader.readDir.mockResolvedValue(['file.ts']);
    // Mesmo mtime do grafo existente → não modifica
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 1000 });

    const result = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });

    expect(result.filesProcessed).toBe(0);
    expect(result.rebuilt).toBe(false);
    // Quando não há nada para processar nem remover, save não é chamado
    expect(mockStore.save).not.toHaveBeenCalled();
  });

  // =========================================================================
  // build - detecta arquivos removidos
  // =========================================================================

  it('detecta e remove nós de arquivos que não existem mais', async () => {
    const existingGraph: KnowledgeGraph = {
      version: 1,
      nodes: [
        makeNode('n1', 'existingFunc', 'file.ts'),
        makeNode('n2', 'deletedFunc', 'deleted.ts'),
      ],
      edges: [makeEdge('n1', 'n2')],
      fileMtimes: { 'file.ts': 1000, 'deleted.ts': 1000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockStore.load.mockResolvedValue(existingGraph);
    mockFileReader.readDir.mockResolvedValue(['file.ts']);
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 2000 });
    mockFileReader.readFile.mockResolvedValue('const x = 1;');
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n1', 'existingFunc', 'file.ts')], edges: [] });

    const result = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });

    expect(mockStore.save).toHaveBeenCalledTimes(1);
    const savedGraph = mockStore.save.mock.calls[0][0] as KnowledgeGraph;
    expect(savedGraph.nodes).toHaveLength(1);
    expect(savedGraph.nodes[0].id).toBe('n1');
    expect(savedGraph.edges).toHaveLength(0);
  });

  // =========================================================================
  // build - respeita maxFiles
  // =========================================================================

  it('respeita maxFiles e não processa mais que o limite', async () => {
    const files: string[] = [];
    for (let i = 0; i < 10; i++) {
      files.push(`file${i}.ts`);
    }

    mockFileReader.readDir.mockResolvedValue(files);
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 1000 });
    mockFileReader.readFile.mockResolvedValue('const x = 1;');
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n', 'f', 'x.ts')], edges: [] });

    const result = await builder.build({ rootDir: '/tmp/proj', maxFiles: 3 });

    expect(result.filesProcessed).toBeLessThanOrEqual(3);
    expect(mockExtractor.extract).toHaveBeenCalledTimes(3);
  });

  // =========================================================================
  // build - ignora pastas de sistema
  // =========================================================================

  it('ignora node_modules, .git, .soberano, dist na coleta', async () => {
    // Primeiro, FileReader.readDir é chamado para /tmp/proj → contém file.ts + pastas
    // Depois, o walk tenta entrar em node_modules, .git, etc — readDir retorna vazio ou são pulados
    mockFileReader.readDir.mockImplementation(async (dir: string) => {
      const base = dir.split('/').pop() || '';
      if (base === 'proj') {
        return ['file.ts', 'node_modules', '.git', '.soberano', 'dist'];
      }
      return [];
    });

    // file.ts é um arquivo
    fsMock.stat.mockImplementation(async (fullPath: string) => {
      if (fullPath.endsWith('file.ts')) {
        return { isDirectory: () => false, isFile: () => true, mtimeMs: 1000 };
      }
      // Pastas bloqueadas: node_modules, .git, .soberano, dist
      // O GraphBuilder checa o basename, não o stat, então o walk nunca chama stat para essas pastas
      return { isDirectory: () => true, isFile: () => false, mtimeMs: 1000 };
    });

    mockFileReader.readFile.mockResolvedValue('const x = 1;');
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n1', 'f', 'file.ts')], edges: [] });

    const result = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });

    expect(result.filesProcessed).toBe(1);
  });

  // =========================================================================
  // build - erro ao ler arquivo não interrompe
  // =========================================================================

  it('não interrompe o build se um arquivo falha ao ser lido', async () => {
    mockFileReader.readDir.mockResolvedValue(['good.ts', 'bad.ts', 'good2.ts']);
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 1000 });
    mockFileReader.readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('bad.ts')) throw new Error('Permission denied');
      return 'const x = 1;';
    });
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n', 'f', 'x.ts')], edges: [] });

    const result = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });

    expect(result.filesProcessed).toBe(2);
  });

  // =========================================================================
  // build - reload do grafo existente
  // =========================================================================

  it('recarrega grafo existente no segundo build', async () => {
    mockFileReader.readDir.mockResolvedValue(['file.ts']);
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 1000 });
    mockFileReader.readFile.mockResolvedValue('class A {}');
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n1', 'A', 'file.ts')], edges: [] });

    const firstResult = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });
    expect(firstResult.totalNodes).toBe(1);

    // Segundo build: load retorna grafo salvo (mockStore.save salvou internamente)
    // Agora o mtime é diferente, então processa novamente
    fsMock.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: 2000 });
    mockFileReader.readFile.mockResolvedValue('class B {}');
    mockExtractor.extract = vi.fn().mockReturnValue({ nodes: [makeNode('n2', 'B', 'file.ts')], edges: [] });

    const secondResult = await builder.build({ rootDir: '/tmp/proj', maxFiles: 100 });

    expect(mockStore.load).toHaveBeenCalledTimes(2);
  });
});
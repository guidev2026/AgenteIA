/**
 * JsonGraphStore: Implementação concreta de IGraphStore + IGraphQuery
 * usando JSON em disco (SRP, DIP, CQRS).
 *
 * Responsabilidade Única:
 * - Persistir o KnowledgeGraph em .soberano/graph.json
 * - Manter índice de adjacência em memória para O(1) em consultas
 * - Implementar IGraphStore (escrita) e IGraphQuery (leitura)
 *
 * Soberania Local: 100% node:fs/promises. Zero dependências externas.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { KnowledgeGraph, GraphNode, GraphEdge, RelationshipType } from './types';
import type { IGraphStore } from './IGraphStore';
import type { IGraphQuery, NeighborNode, ExpandOptions } from './IGraphQuery';

const GRAPH_FILE = '.soberano/graph.json';

/**
 * Índice de adjacência: nodeId → lista de arestas que saem do nó.
 * Construído uma vez no load() para consultas O(1).
 */
interface AdjacencyIndex {
  edgesBySource: Map<string, GraphEdge[]>;
  nodesById: Map<string, GraphNode>;
  nodesByChunkId: Map<string, GraphNode>;
  nodesByFile: Map<string, GraphNode[]>;
}

export class JsonGraphStore implements IGraphStore, IGraphQuery {
  private rootDir: string;
  private graph: KnowledgeGraph | null = null;
  private adjacency: AdjacencyIndex | null = null;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  // =========================================================================
  // IGraphStore — Escrita
  // =========================================================================

  async save(graph: KnowledgeGraph): Promise<void> {
    const cacheDir = path.join(this.rootDir, '.soberano');
    await fs.mkdir(cacheDir, { recursive: true });
    graph.updatedAt = new Date().toISOString();
    await fs.writeFile(
      this.getGraphPath(),
      JSON.stringify(graph, null, 2),
      'utf-8'
    );
    this.graph = graph;
    this.buildAdjacency(graph);
  }

  async load(): Promise<KnowledgeGraph | null> {
    try {
      const content = await fs.readFile(this.getGraphPath(), 'utf-8');
      const graph = JSON.parse(content) as KnowledgeGraph;
      this.graph = graph;
      this.buildAdjacency(graph);
      return graph;
    } catch {
      this.graph = null;
      this.adjacency = null;
      return null;
    }
  }

  async upsertNodes(nodes: GraphNode[]): Promise<void> {
    const graph = await this.getOrCreateGraph();
    const nodeMap = new Map<string, GraphNode>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
    }
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }
    graph.nodes = Array.from(nodeMap.values());
    await this.save(graph);
  }

  async upsertEdges(edges: GraphEdge[]): Promise<void> {
    const graph = await this.getOrCreateGraph();
    const edgeKey = (e: GraphEdge) => `${e.from}|${e.to}|${e.type}`;
    const edgeMap = new Map<string, GraphEdge>();
    for (const e of graph.edges) {
      edgeMap.set(edgeKey(e), e);
    }
    for (const e of edges) {
      edgeMap.set(edgeKey(e), e);
    }
    graph.edges = Array.from(edgeMap.values());
    await this.save(graph);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.getGraphPath());
    } catch {
      // Arquivo não existe — ignorar
    }
    this.graph = null;
    this.adjacency = null;
  }

  // =========================================================================
  // IGraphQuery — Leitura
  // =========================================================================

  getNodeByChunkId(chunkId: string): GraphNode | null {
    if (!this.adjacency) return null;
    return this.adjacency.nodesByChunkId.get(chunkId) ?? null;
  }

  expandNeighborhood(nodeId: string, options: ExpandOptions): NeighborNode[] {
    if (!this.adjacency) return [];

    const { depth, edgeTypes } = options;
    const visited = new Set<string>();
    const result: NeighborNode[] = [];
    const queue: Array<{ id: string; distance: number }> = [];

    visited.add(nodeId);
    queue.push({ id: nodeId, distance: 0 });

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.distance >= depth) continue;

      const edges = this.adjacency!.edgesBySource.get(current.id) ?? [];

      for (const edge of edges) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;

        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          const neighborNode = this.adjacency!.nodesById.get(edge.to);
          if (neighborNode) {
            result.push({
              ...neighborNode,
              edgeType: edge.type,
              distance: current.distance + 1,
            });
          }
          queue.push({ id: edge.to, distance: current.distance + 1 });
        }
      }
    }

    return result;
  }

  getNodesByFile(filePath: string): GraphNode[] {
    if (!this.adjacency) return [];
    return this.adjacency.nodesByFile.get(filePath) ?? [];
  }

  // =========================================================================
  // Privados
  // =========================================================================

  private getGraphPath(): string {
    return path.join(this.rootDir, GRAPH_FILE);
  }

  private async getOrCreateGraph(): Promise<KnowledgeGraph> {
    if (this.graph) return this.graph;
    const loaded = await this.load();
    if (loaded) return loaded;
    const now = new Date().toISOString();
    return {
      version: 1,
      nodes: [],
      edges: [],
      fileMtimes: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Constrói índices de adjacência a partir do grafo carregado.
   * Executado uma vez no load()/save().
   */
  private buildAdjacency(graph: KnowledgeGraph): void {
    const edgesBySource = new Map<string, GraphEdge[]>();
    const nodesById = new Map<string, GraphNode>();
    const nodesByChunkId = new Map<string, GraphNode>();
    const nodesByFile = new Map<string, GraphNode[]>();

    // Indexar nós
    for (const node of graph.nodes) {
      nodesById.set(node.id, node);
      if (node.chunkId) {
        nodesByChunkId.set(node.chunkId, node);
      }
      const fileList = nodesByFile.get(node.filePath) ?? [];
      fileList.push(node);
      nodesByFile.set(node.filePath, fileList);
    }

    // Indexar arestas (direcionais, apenas saída)
    for (const edge of graph.edges) {
      const list = edgesBySource.get(edge.from) ?? [];
      list.push(edge);
      edgesBySource.set(edge.from, list);
    }

    this.adjacency = { edgesBySource, nodesById, nodesByChunkId, nodesByFile };
  }
}

/**
 * Utilitário para gerar IDs hash determinísticos.
 * Usa SHA-256 truncado para 12 caracteres hexadecimais.
 */
export function hashId(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}
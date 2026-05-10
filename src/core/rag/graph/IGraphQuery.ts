/**
 * IGraphQuery: Interface para consultas no KnowledgeGraph (DIP, CQRS).
 *
 * Responsabilidade Única (SRP): Definir o contrato de consulta (read-only)
 * do grafo de conhecimento. Separada de IGraphStore (Command) por ISP.
 *
 * A implementação concreta (JsonGraphStore) implementa ambas as interfaces
 * mas o consumidor (GraphRAGManager) depende apenas desta interface
 * para não ter acesso acidental a operações de escrita.
 */

import type { GraphNode, RelationshipType } from './types';

/**
 * Nó vizinho com metadados da relação.
 */
export interface NeighborNode extends GraphNode {
  /** Tipo da aresta que conecta ao nó de origem */
  edgeType: RelationshipType;
  /** Distância no grafo a partir do nó de origem (1 = direto) */
  distance: number;
}

/**
 * Opções para expansão de vizinhança no grafo.
 */
export interface ExpandOptions {
  /** Profundidade da BFS (1 = apenas vizinhos diretos). Default: 1 */
  depth: number;
  /** Filtro opcional por tipos de aresta (se omitido, retorna todos) */
  edgeTypes?: RelationshipType[];
}

export interface IGraphQuery {
  /**
   * Busca um nó do grafo pelo ID do chunk correspondente.
   *
   * @param chunkId ID do ChunkEntry (ex: "src/core/RAGManager.ts#3")
   * @returns GraphNode ou null se não encontrado
   */
  getNodeByChunkId(chunkId: string): GraphNode | null;

  /**
   * Expande a vizinhança de um nó usando BFS limitada por profundidade.
   *
   * @param nodeId ID do nó de origem
   * @param options Opções de expansão (profundidade, filtro de arestas)
   * @returns Array de nós vizinhos (sem incluir o nó de origem)
   */
  expandNeighborhood(nodeId: string, options: ExpandOptions): NeighborNode[];

  /**
   * Retorna todos os nós pertencentes a um arquivo.
   *
   * @param filePath Caminho relativo do arquivo
   * @returns Array de nós do arquivo (vazio se nenhum)
   */
  getNodesByFile(filePath: string): GraphNode[];
}
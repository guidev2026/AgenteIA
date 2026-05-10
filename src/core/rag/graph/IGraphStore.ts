/**
 * IGraphStore: Interface para persistência do KnowledgeGraph (DIP).
 *
 * Responsabilidade Única (SRP): Definir o contrato de armazenamento
 * do grafo de conhecimento. A implementação concreta (JsonGraphStore)
 * cuida da serialização em disco.
 *
 * ISP: Métodos segregados — CRUD básico de nós/arestas, sem lógica de busca.
 * A busca fica em IGraphQuery.
 */

import type { KnowledgeGraph, GraphNode, GraphEdge } from './types';

export interface IGraphStore {
  /**
   * Persiste o grafo completo em disco.
   * Substitui completamente o arquivo anterior.
   */
  save(graph: KnowledgeGraph): Promise<void>;

  /**
   * Carrega o grafo do disco.
   * @returns KnowledgeGraph ou null se o arquivo não existir.
   */
  load(): Promise<KnowledgeGraph | null>;

  /**
   * Insere ou atualiza nós no grafo.
   * Usa `id` como chave: se o nó já existe, substitui (merge).
   */
  upsertNodes(nodes: GraphNode[]): Promise<void>;

  /**
   * Insere ou atualiza arestas no grafo.
   * Usa a chave composta `from|to|type` para deduplicação.
   */
  upsertEdges(edges: GraphEdge[]): Promise<void>;

  /**
   * Remove o arquivo de grafo do disco.
   * Usado para resetar o cache.
   */
  clear(): Promise<void>;
}
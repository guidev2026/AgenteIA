/**
 * IRelationshipExtractor: Interface para extração de relações entre símbolos (DIP).
 *
 * Responsabilidade Única (SRP): Extrair relações semânticas (arestas)
 * de um arquivo de código fonte. A implementação concreta
 * (ASTRelationshipExtractor) analisa o AST para descobrir chamadas,
 * heranças, imports, etc.
 *
 * ISP: Segregada do armazenamento — esta interface não sabe onde
 * o grafo é persistido.
 */

import type { GraphNode, GraphEdge } from './types';

/**
 * Resultado da extração de relações de um único arquivo.
 * Contém apenas os novos nós e arestas descobertos.
 */
export interface ExtractionResult {
  /** Novos nós descobertos (funções, classes, interfaces) */
  nodes: GraphNode[];
  /** Novas arestas descobertas (CALLS, IMPORTS, EXTENDS, etc.) */
  edges: GraphEdge[];
}

export interface IRelationshipExtractor {
  /**
   * Extrai relações semânticas do código fonte de um arquivo.
   *
   * @param filePath Caminho relativo do arquivo (usado para namespacing dos IDs)
   * @param source Conteúdo completo do arquivo
   * @returns ExtractionResult com os nós e arestas descobertos.
   *          Retorna `{ nodes: [], edges: [] }` se o código for inválido
   *          ou se o arquivo não for suportado.
   */
  extract(filePath: string, source: string): ExtractionResult;
}
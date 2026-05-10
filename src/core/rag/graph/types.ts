/**
 * GraphRAG Local — Tipos de domínio do KnowledgeGraph.
 *
 * Define as estruturas de dados para representar o grafo de conhecimento
 * que mapeia relações entre chunks, funções, classes, interfaces e arquivos.
 *
 * ISP: Interfaces segregadas — cada tipo tem uma responsabilidade única.
 */

/**
 * Relação semântica entre dois nós do grafo.
 */
export type RelationshipType =
  | 'CALLS'         // Função A chama Função B (detectado via AST: CallExpression)
  | 'IMPORTS'       // Arquivo X importa Módulo Y (AST: ImportDeclaration)
  | 'EXTENDS'       // Classe X herda de Classe Y (AST: HeritageClause)
  | 'IMPLEMENTS'    // Classe X implementa Interface Y (AST: HeritageClause)
  | 'BELONGS_TO'    // Chunk/Função pertence a um Arquivo
  | 'CONTAINS'      // Arquivo/Classe contém Função/Método (inverso de BELONGS_TO)
  | 'REFERENCES';   // Referência genérica (fallback para export/require)

/**
 * Nó do grafo de conhecimento.
 * Representa um símbolo do código fonte (função, classe, chunk, arquivo).
 */
export interface GraphNode {
  /** Identificador único do nó (hash determinístico) */
  id: string;
  /** Nome legível — ex: "RAGManager.ensureIndex()" */
  label: string;
  /** Tipo do nó */
  type: 'chunk' | 'function' | 'method' | 'class' | 'interface' | 'file';
  /** ID do ChunkEntry correspondente (apenas para type='chunk') */
  chunkId?: string;
  /** Caminho relativo do arquivo de origem */
  filePath: string;
  /** Linha inicial no arquivo (1-based) */
  startLine: number;
  /** Linha final no arquivo (1-based) */
  endLine: number;
}

/**
 * Aresta direcionada entre dois nós do grafo.
 */
export interface GraphEdge {
  /** ID do nó de origem */
  from: string;
  /** ID do nó de destino */
  to: string;
  /** Tipo da relação semântica */
  type: RelationshipType;
  /** Metadados opcionais — ex: { lineNumber: 42 } */
  metadata?: Record<string, unknown>;
}

/**
 * Grafo de conhecimento completo.
 * Persistido em .soberano/graph.json.
 */
export interface KnowledgeGraph {
  /** Versão da estrutura do grafo (para migrações futuras) */
  version: number;
  /** Todos os nós do grafo */
  nodes: GraphNode[];
  /** Todas as arestas do grafo */
  edges: GraphEdge[];
  /** Mapeamento de filePath → mtimeMs para detecção incremental */
  fileMtimes: Record<string, number>;
  /** Timestamp ISO de criação */
  createdAt: string;
  /** Timestamp ISO da última atualização */
  updatedAt: string;
}

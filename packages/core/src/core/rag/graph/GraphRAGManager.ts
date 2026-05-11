/**
 * GraphRAGManager: Busca híbrida que combina similaridade vetorial (RAG clássico)
 * com navegação em grafo de conhecimento (GraphRAG).
 *
 * Responsabilidade Única (SRP):
 * - Receber uma consulta de busca
 * - Executar retrieve vetorial (via Retriever)
 * - Expandir os top-N resultados com vizinhança no grafo (via IGraphQuery)
 * - Mesclar e ranquear resultados combinados
 * - Formatar resultado para prompt
 *
 * DIP: Depende de Retriever e IGraphQuery (abstrações).
 * OCP: Novas estratégias de ranqueamento podem ser adicionadas sem modificar esta classe.
 */

import { Retriever, type SearchMatch } from '../Retriever';
import type { IGraphQuery, NeighborNode, ExpandOptions } from './IGraphQuery';
import type { ChunkEntry } from '../VectorStore';

/**
 * Opções de busca híbrida.
 */
export interface GraphSearchOptions {
  /** Número de resultados vetoriais iniciais (default 5) */
  topK?: number;
  /** Profundidade de expansão no grafo (default 2) */
  graphDepth?: number;
  /** Tipos de aresta para filtrar expansão (default: todos) */
  edgeTypes?: ExpandOptions['edgeTypes'];
  /** Peso da relevância textual vs estrutural (0..1, default 0.7) */
  textWeight?: number;
}

/**
 * Resultado da busca híbrida.
 */
export interface GraphSearchResult {
  /** Resultados combinados e ranqueados */
  matches: SearchMatch[];
  /** Nós do grafo visitados durante a expansão */
  visitedNodes: NeighborNode[];
  /** Total de chunks antes da expansão */
  baseChunks: number;
  /** Total de chunks após expansão */
  expandedChunks: number;
}

export class GraphRAGManager {
  private readonly retriever: Retriever;
  private readonly graphQuery: IGraphQuery;

  constructor(retriever: Retriever, graphQuery: IGraphQuery) {
    this.retriever = retriever;
    this.graphQuery = graphQuery;
  }

  /**
   * Busca híbrida: similaridade vetorial + expansão em grafo.
   *
   * Algoritmo:
   * 1. Retrieve vetorial (top-K chunks por similaridade de cosseno)
   * 2. Para cada chunk nos top resultados, encontra nó do grafo via chunk.id
   * 3. Expande vizinhança de cada nó (profundidade configurável)
   * 4. Coleta filePaths dos nós vizinhos
   * 5. Adiciona chunks dos arquivos vizinhos ao resultado (se não duplicados)
   * 6. Re-ranqueia por score combinado (textual * textWeight + estrutural * (1-textWeight))
   * 7. Retorna top-K final
   */
  async search(
    queryEmbedding: number[],
    chunks: ChunkEntry[],
    options: GraphSearchOptions = {}
  ): Promise<GraphSearchResult> {
    const {
      topK = 5,
      graphDepth = 2,
      edgeTypes,
      textWeight = 0.7,
    } = options;

    // 1. Retrieve vetorial
    const baseMatches = this.retriever.retrieve(queryEmbedding, chunks);
    const topMatches = baseMatches.slice(0, topK);

    // 2. Para cada match, encontra nó no grafo e expande
    const visitedFiles = new Set<string>();
    const allNodes: NeighborNode[] = [];
    const expandedFilePaths = new Set<string>();

    for (const match of topMatches) {
      const chunkId = match.chunk.id;
      const node = this.graphQuery.getNodeByChunkId(chunkId);
      if (!node) continue;

      if (!visitedFiles.has(node.filePath)) {
        visitedFiles.add(node.filePath);
        expandedFilePaths.add(node.filePath);
      }

      // Expande vizinhança
      const neighbors = this.graphQuery.expandNeighborhood(node.id, {
        depth: graphDepth,
        edgeTypes,
      });

      for (const neighbor of neighbors) {
        allNodes.push(neighbor);
        if (!visitedFiles.has(neighbor.filePath)) {
          visitedFiles.add(neighbor.filePath);
          expandedFilePaths.add(neighbor.filePath);
        }
      }
    }

    // 3. Adiciona chunks dos arquivos vizinhos (não duplicados)
    const seenChunkIds = new Set(topMatches.map((m) => m.chunk.id));
    const structuralExtra: SearchMatch[] = [];

    for (const chunk of chunks) {
      if (seenChunkIds.has(chunk.id)) continue;
      if (expandedFilePaths.has(chunk.filePath)) {
        const node = this.graphQuery.getNodeByChunkId(chunk.id);
        let structuralScore = 0.3; // score base para arquivo vizinho

        if (node) {
          // Verifica se o nó está nos vizinhos expandidos
          const neighborInfo = allNodes.find((n) => n.id === node.id);
          if (neighborInfo) {
            // Score inversamente proporcional à distância
            structuralScore = Math.max(0.1, 1.0 / (neighborInfo.distance + 1));
          }
        }

        structuralExtra.push({
          chunk,
          score: structuralScore,
        });
        seenChunkIds.add(chunk.id);
      }
    }

    // 4. Mescla e re-ranqueia
    const combined: SearchMatch[] = [];

    // Matches vetoriais mantêm seu score original * textWeight
    for (const match of topMatches) {
      combined.push({
        chunk: match.chunk,
        score: match.score * textWeight,
      });
    }

    // Matches estruturais recebem (1 - textWeight) * structuralScore
    for (const match of structuralExtra) {
      combined.push({
        chunk: match.chunk,
        score: match.score * (1 - textWeight),
      });
    }

    // Ordena por score descendente
    combined.sort((a, b) => b.score - a.score);

    return {
      matches: combined.slice(0, topK + structuralExtra.length),
      visitedNodes: allNodes,
      baseChunks: topMatches.length,
      expandedChunks: structuralExtra.length,
    };
  }

  /**
   * Formata resultado híbrido para inclusão no prompt.
   * Inclui contexto textual e informações estruturais do grafo.
   */
  formatGraphContext(result: GraphSearchResult): string {
    const lines: string[] = [
      '=== CONTEXTO HÍBRIDO (Vetorial + Grafo) ===',
      '',
    ];

    // Resultados textuais
    for (let i = 0; i < result.matches.length; i++) {
      const m = result.matches[i];
      lines.push(
        `[${i + 1}] ${m.chunk.filePath}:${m.chunk.startLine}-${m.chunk.endLine} ` +
        `(score: ${m.score.toFixed(3)})`
      );
      lines.push('```');
      lines.push(m.chunk.text);
      lines.push('```');
      lines.push('');
    }

    // Informações estruturais
    if (result.visitedNodes.length > 0) {
      lines.push('=== RELAÇÕES ESTRUTURAIS ===');
      const grouped = new Map<string, Set<string>>();
      for (const node of result.visitedNodes) {
        const key = `${node.filePath}:${node.label}`;
        if (!grouped.has(key)) {
          grouped.set(key, new Set());
        }
        grouped.get(key)!.add(node.edgeType);
      }

      for (const [key, types] of grouped) {
        lines.push(`  ${key} — [${Array.from(types).join(', ')}]`);
      }
      lines.push('');
    }

    lines.push(
      `Base chunks: ${result.baseChunks} | ` +
      `Expanded chunks: ${result.expandedChunks}`
    );

    return lines.join('\n');
  }
}
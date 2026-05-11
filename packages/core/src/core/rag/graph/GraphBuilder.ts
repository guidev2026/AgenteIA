/**
 * GraphBuilder: Orquestrador de construção do KnowledgeGraph.
 *
 * Responsabilidade Única (SRP):
 * - Percorrer diretório de código fonte
 * - Para cada arquivo .ts/.js, delegar extração ao IRelationshipExtractor
 * - Acumular todos os nós e arestas
 * - Persistir o grafo via IGraphStore
 *
 * DIP: Depende de IRelationshipExtractor e IGraphStore (abstrações).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileReader } from '../../FileReader';
import type { IRelationshipExtractor } from './IRelationshipExtractor';
import type { IGraphStore } from './IGraphStore';
import type { KnowledgeGraph, GraphNode, GraphEdge } from './types';

// Extensões de código-fonte relevantes para o grafo
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

export interface GraphBuildOptions {
  /** Diretório raiz para indexar */
  rootDir: string;
  /** Máximo de arquivos a processar (default 200) */
  maxFiles?: number;
  /** Versão do grafo (default 1) */
  version?: number;
}

export interface GraphBuildResult {
  /** Total de nós no grafo final */
  totalNodes: number;
  /** Total de arestas no grafo final */
  totalEdges: number;
  /** Número de arquivos processados */
  filesProcessed: number;
  /** Se o grafo foi recriado do zero ou atualizado incrementalmente */
  rebuilt: boolean;
}

export class GraphBuilder {
  private readonly fileReader: FileReader;
  private readonly relationshipExtractor: IRelationshipExtractor;
  private readonly graphStore: IGraphStore;

  constructor(
    fileReader: FileReader,
    relationshipExtractor: IRelationshipExtractor,
    graphStore: IGraphStore
  ) {
    this.fileReader = fileReader;
    this.relationshipExtractor = relationshipExtractor;
    this.graphStore = graphStore;
  }

  /**
   * Constrói ou atualiza o KnowledgeGraph para o diretório informado.
   *
   * Estratégia incremental:
   * - Carrega grafo existente (se houver)
   * - Processa apenas arquivos modificados (por mtime)
   * - Remove nós/arestas de arquivos removidos
   * - Mescla com grafo existente
   */
  async build(options: GraphBuildOptions): Promise<GraphBuildResult> {
    const absoluteRoot = path.resolve(options.rootDir);
    const maxFiles = options.maxFiles ?? 200;
    const version = options.version ?? 1;

    // 1. Carrega grafo existente (se houver)
    const existingGraph = await this.graphStore.load();
    const previousFileMtimes = existingGraph?.fileMtimes ?? {};

    // 2. Coleta arquivos fonte
    const sourceFiles = await this.collectSourceFiles(absoluteRoot, maxFiles);

    // 3. Determina arquivos modificados e removidos
    const currentPaths = new Set(sourceFiles.map((f) => f.relPath));
    const filesToProcess: SourceFile[] = [];
    let rebuilt = false;

    for (const file of sourceFiles) {
      const prevMtime = previousFileMtimes[file.relPath];
      if (prevMtime !== undefined && prevMtime === file.mtime) {
        continue; // não modificado
      }
      filesToProcess.push(file);
    }

    // Arquivos que existiam antes mas não existem mais → remover
    const removedPaths = Object.keys(previousFileMtimes).filter(
      (p) => !currentPaths.has(p)
    );

    // Se não há nada para processar, retorna estado atual
    if (filesToProcess.length === 0 && removedPaths.length === 0 && existingGraph) {
      return {
        totalNodes: existingGraph.nodes.length,
        totalEdges: existingGraph.edges.length,
        filesProcessed: 0,
        rebuilt: false,
      };
    }

    // 4. Processa arquivos modificados/novos
    const allNodes: Map<string, GraphNode> = new Map();
    const allEdges: Set<string> = new Set();
    const edgeMap: Map<string, GraphEdge> = new Map();
    const newFileMtimes: Record<string, number> = {};
    let processedCount = 0;

    // Helper para chave única de aresta (dedup)
    const edgeKey = (e: GraphEdge): string => `${e.from}|${e.to}|${e.type}`;

    // Pré-carrega nós/arestas existentes (exceto de arquivos removidos)
    if (existingGraph) {
      for (const node of existingGraph.nodes) {
        const filePath = node.filePath;
        if (removedPaths.includes(filePath)) continue;
        allNodes.set(node.id, node);
      }
      for (const edge of existingGraph.edges) {
        const key = edgeKey(edge);
        // Verificar se a aresta envolve algum nó de arquivo removido
        const fromNode = allNodes.get(edge.from);
        const toNode = allNodes.get(edge.to);
        if (!fromNode || !toNode) continue;
        if (removedPaths.includes(fromNode.filePath) || removedPaths.includes(toNode.filePath)) continue;
        if (!allEdges.has(key)) {
          allEdges.add(key);
          edgeMap.set(key, edge);
        }
      }
      // Preserva mtimes de arquivos não modificados
      for (const [relPath, mtime] of Object.entries(previousFileMtimes)) {
        if (!filesToProcess.some((f) => f.relPath === relPath) && !removedPaths.includes(relPath)) {
          newFileMtimes[relPath] = mtime;
        }
      }
    }

    // Processa arquivos modificados — paralelizado
    const extractionResults = await Promise.allSettled(
      filesToProcess.map(async (file) => {
        const content = await this.fileReader.readFile(file.fullPath);
        const result = this.relationshipExtractor.extract(file.relPath, content);
        return { file, result };
      })
    );

    for (const settled of extractionResults) {
      if (settled.status === 'rejected') continue;
      const { file, result } = settled.value;

      // Remove nós/arestas antigos deste arquivo (se estava no grafo anterior)
      const previousNodes = existingGraph
        ? existingGraph.nodes.filter((n) => n.filePath === file.relPath)
        : [];
      for (const prevNode of previousNodes) {
        allNodes.delete(prevNode.id);
      }
      // Remove arestas conectadas a nós antigos
      const previousNodeIds = new Set(previousNodes.map((n) => n.id));
      for (const [key, edge] of edgeMap) {
        if (previousNodeIds.has(edge.from) || previousNodeIds.has(edge.to)) {
          allEdges.delete(key);
          edgeMap.delete(key);
        }
      }

      // Adiciona novos nós/arestas
      for (const node of result.nodes) {
        allNodes.set(node.id, node);
      }
      for (const edge of result.edges) {
        const key = edgeKey(edge);
        if (!allEdges.has(key)) {
          allEdges.add(key);
          edgeMap.set(key, edge);
        }
      }

      newFileMtimes[file.relPath] = file.mtime;
      processedCount++;
      rebuilt = true;
    }

    // 5. Monta grafo final
    const now_iso = new Date().toISOString();
    const graph: KnowledgeGraph = {
      version,
      nodes: Array.from(allNodes.values()),
      edges: Array.from(edgeMap.values()),
      fileMtimes: newFileMtimes,
      createdAt: existingGraph?.createdAt ?? now_iso,
      updatedAt: now_iso,
    };

    // 6. Persiste
    await this.graphStore.save(graph);

    return {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      filesProcessed: processedCount,
      rebuilt,
    };
  }

  /**
   * Coleta arquivos fonte recursivamente.
   */
  private async collectSourceFiles(
    rootDir: string,
    maxFiles: number
  ): Promise<SourceFile[]> {
    const all: SourceFile[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (all.length >= maxFiles) return;
      let entries: string[];
      try {
        entries = await this.fileReader.readDir(dir);
      } catch {
        return;
      }

      // Paraleliza fs.stat em todas as entradas do diretório
      const entriesWithStats = await Promise.all(
        entries.map(async (entry): Promise<{ entry: string; fullPath: string; stat: import('node:fs').Stats | null }> => {
          const fullPath = path.join(dir, entry);
          try {
            const stat = await fs.stat(fullPath);
            return { entry, fullPath, stat };
          } catch {
            return { entry, fullPath, stat: null };
          }
        })
      );

      for (const { entry, fullPath, stat } of entriesWithStats) {
        if (all.length >= maxFiles) break;
        if (!stat) continue;

        if (stat.isDirectory()) {
          const base = path.basename(entry);
          if (base === 'node_modules' || base === '.git' ||
              base === '.soberano' || base === 'dist') continue;
          await walk(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (SOURCE_EXTENSIONS.has(ext)) {
            const relPath = path.relative(rootDir, fullPath);
            all.push({
              fullPath,
              relPath,
              mtime: stat.mtimeMs,
            });
          }
        }
      }
    };

    await walk(rootDir);
    return all.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }
}

interface SourceFile {
  fullPath: string;
  relPath: string;
  mtime: number;
}
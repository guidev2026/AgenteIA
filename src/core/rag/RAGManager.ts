/**
 * RAGManager: Orquestrador do pipeline RAG + GraphRAG (SRP — orquestração pura).
 *
 * Responsabilidade Única: Coordenar as etapas do pipeline RAG:
 * 1. Coletar arquivos texto do diretório
 * 2. Chunking (delega para Chunker)
 * 3. Embedding (delega para Embedder)
 * 4. Cache em disco (delega para VectorStore)
 * 5. Busca semântica (delega para Retriever)
 * 6. Construção do KnowledgeGraph (delega para GraphBuilder)
 *
 * Esta classe NÃO implementa chunking, NÃO gera embeddings,
 * NÃO salva arquivos, NÃO constrói grafos — ela apenas coordena as peças.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileReader } from '../FileReader';
import { Chunker } from './Chunker';
import type { IChunker } from './IChunker';
import { Embedder } from './Embedder';
import { VectorStore } from './VectorStore';
import { Retriever } from './Retriever';
import type { SearchMatch } from './Retriever';
import type { ChunkEntry } from './VectorStore';
import type { IEmbedProvider } from '../../providers/types';
import { GraphBuilder } from './graph/GraphBuilder';
import type { IGraphStore } from './graph/IGraphStore';
import type { IGraphQuery } from './graph/IGraphQuery';
import type { IRelationshipExtractor } from './graph/IRelationshipExtractor';
import { ASTRelationshipExtractor } from './graph/ASTRelationshipExtractor';
import { JsonGraphStore } from './graph/JsonGraphStore';
import { TypescriptASTAdapter } from './TypescriptASTAdapter';
import { ASTChunkerService } from './ASTChunkerService';
import { GraphRAGManager } from './graph/GraphRAGManager';

// Extensões de arquivos texto para indexar
const TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.json', '.md', '.txt', '.html', '.css',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.sh', '.bash', '.zshrc', '.gitignore',
]);

export class RAGManager {
  private readonly fileReader: FileReader;
  private readonly chunker: IChunker;
  private readonly embedder: Embedder;
  private readonly vectorStore: VectorStore;
  private readonly retriever: Retriever;
  private readonly graphBuilder: GraphBuilder | null;
  private readonly graphRAGManager: GraphRAGManager | null;

  constructor(
    fileReader: FileReader,
    chunker: IChunker,
    embedder: Embedder,
    vectorStore: VectorStore,
    retriever: Retriever,
    graphBuilder?: GraphBuilder | null,
    graphRAGManager?: GraphRAGManager | null
  ) {
    this.fileReader = fileReader;
    this.chunker = chunker;
    this.embedder = embedder;
    this.vectorStore = vectorStore;
    this.retriever = retriever;
    this.graphBuilder = graphBuilder ?? null;
    this.graphRAGManager = graphRAGManager ?? null;
  }

  /**
   * Factory method: cria RAGManager completo com instâncias default.
   * Útil para consumo externo (ex: CLI) onde não se quer instanciar
   * cada dependência manualmente.
   *
   * @param fileReader FileReader para ler arquivos
   * @param embedProvider Provider de embeddings (ex: OllamaProvider)
   * @param graphStorePath Caminho para persistir o grafo (opcional, ex: ".soberano/graph.json")
   */
  static create(
    fileReader: FileReader,
    embedProvider: IEmbedProvider,
    chunker?: IChunker,
    graphStorePath?: string
  ): RAGManager {
    // Default: ASTChunkerService com fallback textual
    const astParser = new TypescriptASTAdapter();
    const fallbackChunker = new Chunker();
    const effectiveChunker = chunker ?? new ASTChunkerService(astParser, fallbackChunker);

    const embedder = new Embedder(embedProvider);
    const vectorStore = new VectorStore();
    const retriever = new Retriever();
    let graphBuilder: GraphBuilder | undefined;
    let graphRAGManager: GraphRAGManager | undefined;

    if (graphStorePath) {
      const graphStore: IGraphStore & IGraphQuery = new JsonGraphStore(graphStorePath);
      const extractor: IRelationshipExtractor = new ASTRelationshipExtractor(astParser, effectiveChunker);
      graphBuilder = new GraphBuilder(fileReader, extractor, graphStore);
      graphRAGManager = new GraphRAGManager(retriever, graphStore);
    }
    return new RAGManager(fileReader, effectiveChunker, embedder, vectorStore, retriever, graphBuilder, graphRAGManager);
  }

  /**
   * Verifica se um arquivo é texto (vs binário) baseado nos primeiros bytes.
   */
  private isTextContent(content: string): boolean {
    for (let i = 0; i < Math.min(content.length, 1000); i++) {
      const code = content.charCodeAt(i);
      if (code === 0) return false;
    }
    return true;
  }

  /**
   * Coleta arquivos texto de um diretório recursivamente.
   */
  private async collectTextFiles(
    rootDir: string,
    maxFiles: number = 200
  ): Promise<string[]> {
    const all: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (all.length >= maxFiles) return;
      let entries: string[];
      try {
        entries = await this.fileReader.readDir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (all.length >= maxFiles) break;
        const fullPath = path.join(dir, entry);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat) continue;

        if (stat.isDirectory()) {
          const base = path.basename(entry);
          if (base === 'node_modules' || base === '.git' ||
              base === '.soberano' || base === 'dist') continue;
          await walk(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (TEXT_EXTENSIONS.has(ext)) {
            all.push(fullPath);
          }
        }
      }
    };

    await walk(rootDir);
    return all.sort();
  }

  /**
   * Garante que o índice existe para o diretório informado.
   * Se o cache estiver atualizado, reutiliza.
   * Indexa apenas arquivos novos/modificados.
   */
  async ensureIndex(rootDir: string): Promise<void> {
    const absoluteRoot = path.resolve(rootDir);
    const existingIndex = await this.vectorStore.load(absoluteRoot);
    const now = Date.now();

    // 1. Coleta arquivos
    const docPath = path.resolve('DOCUMENTACAO_PROJETO.md');
    const allFiles = await this.collectTextFiles(absoluteRoot);

    // 2. Monta lista com DOCUMENTACAO_PROJETO.md sempre primeiro
    const docExists = await fs.stat(docPath).then(() => true).catch(() => false);
    const filesToIndex: string[] = [];

    if (docExists) filesToIndex.push(docPath);

    for (const f of allFiles) {
      if (f !== docPath) {
        if (f.startsWith(absoluteRoot + path.sep) || f.startsWith(absoluteRoot)) {
          filesToIndex.push(f);
        }
      }
    }

    // 3. Verifica quais precisam ser (re)indexados
    const filesToProcess: string[] = [];
    for (const filePath of filesToIndex) {
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }
      const relPath = path.relative(absoluteRoot, filePath);
      const cachedMeta = existingIndex?.files?.[relPath];
      if (cachedMeta && cachedMeta.mtime === stat.mtimeMs) continue;
      filesToProcess.push(filePath);
    }

    // Se não há nada para processar, usa índice existente
    if (filesToProcess.length === 0 && existingIndex) return;

    // 4. Indexa arquivos novos/modificados
    const newChunks: ChunkEntry[] = [];

    for (const filePath of filesToProcess) {
      let content: string;
      try {
        content = await this.fileReader.readFile(filePath);
      } catch {
        continue;
      }
      if (!this.isTextContent(content)) continue;

      const chunks = this.chunker.chunk(content);
      if (chunks.length === 0) continue;

      const relPath = path.relative(absoluteRoot, filePath);

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const chunkId = `${relPath}#${ci}`;
        let embedding: number[];
        try {
          embedding = await this.embedder.embed(chunk.text);
        } catch {
          continue;
        }

        newChunks.push({
          id: chunkId,
          text: chunk.text,
          filePath: relPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          embedding,
          indexedAt: now,
        });
      }
    }

    // 5. Descarrega modelo de embedding
    await this.embedder.unload();

    // 6. Mescla com índice existente
    let finalChunks: ChunkEntry[];
    let finalFiles: Record<string, { mtime: number; chunks: number }>;

    if (existingIndex) {
      const reindexedPaths = new Set(filesToProcess.map((f) => path.relative(absoluteRoot, f)));
      finalChunks = existingIndex.chunks.filter((c) => !reindexedPaths.has(c.filePath));
      finalChunks.push(...newChunks);
      finalFiles = { ...existingIndex.files };

      for (const filePath of filesToProcess) {
        const relPath = path.relative(absoluteRoot, filePath);
        const relevantChunks = newChunks.filter((c) => c.filePath === relPath);
        const stat = await fs.stat(filePath).catch(() => null);
        finalFiles[relPath] = {
          mtime: stat ? stat.mtimeMs : now,
          chunks: relevantChunks.length,
        };
      }
    } else {
      finalChunks = newChunks;
      finalFiles = {};
      for (const filePath of filesToProcess) {
        const relPath = path.relative(absoluteRoot, filePath);
        const relevantChunks = newChunks.filter((c) => c.filePath === relPath);
        const stat = await fs.stat(filePath).catch(() => null);
        finalFiles[relPath] = {
          mtime: stat ? stat.mtimeMs : now,
          chunks: relevantChunks.length,
        };
      }
    }

    // 7. Salva índice
    await this.vectorStore.save(absoluteRoot, {
      formatVersion: 1,
      embedModel: 'all-minilm',
      dimensions: 384,
      indexedAt: now,
      files: finalFiles,
      chunks: finalChunks,
    });

    // 8. Constrói/atualiza o KnowledgeGraph (se habilitado)
    if (this.graphBuilder) {
      await this.graphBuilder.build({ rootDir: absoluteRoot, maxFiles: filesToIndex.length });
    }
  }

  /**
   * Busca os chunks mais similares à consulta.
   * Se o GraphRAGManager estiver disponível, enriquece os resultados
   * com expansão de vizinhança no grafo de conhecimento.
   */
  async retrieve(query: string, rootDir: string): Promise<SearchMatch[]> {
    const absoluteRoot = path.resolve(rootDir);
    const queryEmbedding = await this.embedder.embed(query, 'all-minilm', '0s');

    // Carrega índice
    const store = await this.vectorStore.load(absoluteRoot);
    if (!store || store.chunks.length === 0) return [];

    // Busca vetorial base
    if (!this.graphRAGManager) {
      return this.retriever.retrieve(queryEmbedding, store.chunks);
    }

    // Busca híbrida: vetorial + grafo de conhecimento
    const graphResult = await this.graphRAGManager.search(
      queryEmbedding,
      store.chunks,
      { topK: 5, graphDepth: 2 }
    );

    return graphResult.matches;
  }

  /**
   * Formata os resultados em contexto.
   */
  formatContext(matches: SearchMatch[]): string {
    return this.retriever.formatContext(matches);
  }
}
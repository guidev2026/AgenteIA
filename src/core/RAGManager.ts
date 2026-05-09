import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { FileReader } from './FileReader';
import type { OllamaProvider } from '../providers/OllamaProvider';

// ─────────────────────────────────────────────────────────────
//  Tipos internos do RAGManager
// ─────────────────────────────────────────────────────────────

/** Um chunk de texto com metadados */
export interface ChunkEntry {
  id: string;               // hash único: "relativePath#index"
  text: string;             // conteúdo do chunk
  filePath: string;         // caminho relativo ao diretório indexado
  startLine: number;        // linha inicial no arquivo original
  endLine: number;          // linha final no arquivo orginal
  embedding: number[];      // vetor 384-dim do all-minilm
  indexedAt: number;        // timestamp da indexação
}

/** Metadados de arquivo para cache (evitar re-embedding) */
interface FileMeta {
  mtime: number;
  chunks: number;
}

/** Estrutura completa do índice em disco */
interface IndexStore {
  formatVersion: 1;
  embedModel: string;       // modelo usado para embedding
  dimensions: number;       // 384 para all-minilm
  indexedAt: number;
  files: Record<string, FileMeta>;
  chunks: ChunkEntry[];
}

/** Resultado da busca com score de similaridade */
export interface SearchMatch {
  chunk: ChunkEntry;
  score: number;            // 0.0 a 1.0
}

// ─────────────────────────────────────────────────────────────
//  Constantes
// ─────────────────────────────────────────────────────────────

const MAX_CHUNK_SIZE = 2000;        // caracteres (~500 tokens)
const OVERLAP = 200;                 // sobreposição entre chunks
const MAX_CHUNKS_PER_FILE = 50;     // limite por arquivo
const SIMILARITY_THRESHOLD = 0.25;  // score mínimo para considerar relevante
const TOP_K = 5;                    // top K chunks para retornar
const CACHE_DIR = '.soberano';      // diretório de cache
const INDEX_FILE = 'index.json';    // nome do arquivo de índice

// Extensões de arquivos texto para indexar
const TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.json', '.md', '.txt', '.html', '.css',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.sh', '.bash', '.zshrc', '.gitignore',
]);

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Verifica se um arquivo é texto (vs binário) baseado nos primeiros bytes.
 */
function isTextContent(content: string): boolean {
  // Se tiver caracteres de controle (exceto quebras de linha/tab) é binário
  for (let i = 0; i < Math.min(content.length, 1000); i++) {
    const code = content.charCodeAt(i);
    if (code === 0) return false; // null byte → binário
  }
  return true;
}

/**
 * Cosine Similarity — implementação nativa TypeScript, zero dependências.
 *
 * Fórmula: cos(θ) = (A·B) / (||A|| × ||B||)
 * Onde:
 *   A·B   = dot product
 *   ||A|| = sqrt(sum(A_i²))
 *   ||B|| = sqrt(sum(B_i²))
 *
 * Resultado: 1.0 = vetores idênticos, 0.0 = ortogonais, < 0 = opostos
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: ${a.length} vs ${b.length}. ` +
      `Ensure the embedding model is consistent.`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ─────────────────────────────────────────────────────────────
//  Chunking (Fatiamento Semântico)
// ─────────────────────────────────────────────────────────────

interface ChunkResult {
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Divide o conteúdo de um arquivo em chunks, respeitando:
 * - Parágrafos (divisão por \n\n) como unidade principal
 * - MAX_CHUNK_SIZE como limite de caracteres por chunk
 * - Overlap entre chunks consecutivos
 * - Limite MAX_CHUNKS_PER_FILE
 */
function chunkText(content: string): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const paragraphs = content.split('\n\n');
  let currentLine = 1;

  for (let i = 0; i < paragraphs.length && chunks.length < MAX_CHUNKS_PER_FILE; i++) {
    const para = paragraphs[i];
    if (!para.trim()) {
      currentLine += para.split('\n').length;
      continue;
    }

    // Se o parágrafo cabe em um chunk
    if (para.length <= MAX_CHUNK_SIZE) {
      const paraLines = para.split('\n');
      chunks.push({
        text: para,
        startLine: currentLine,
        endLine: currentLine + paraLines.length - 1,
      });
      currentLine += paraLines.length + 1; // +1 pelo \n\n
      continue;
    }

    // Parágrafo muito grande: divide por sentenças
    const sentences = para.match(/[^.!?\n]+[.!?]*\s*/g) || [para];
    let buffer = '';
    let bufferStartLine = currentLine;
    let bufferLineCount = 0;

    for (const sentence of sentences) {
      if ((buffer + sentence).length > MAX_CHUNK_SIZE && buffer) {
        chunks.push({
          text: buffer.trim(),
          startLine: bufferStartLine,
          endLine: bufferStartLine + bufferLineCount - 1,
        });
        bufferStartLine += bufferLineCount;
        bufferLineCount = 0;

        // Overlap: mantém os últimos OVERLAP caracteres
        const overlapStart = Math.max(0, buffer.length - OVERLAP);
        buffer = buffer.slice(overlapStart);
        bufferLineCount = buffer.split('\n').length - 1;
        bufferStartLine += (OVERLAP > 0 ? 1 : 0);
      }

      buffer += sentence;
      bufferLineCount += sentence.split('\n').length - 1;
    }

    if (buffer.trim()) {
      chunks.push({
        text: buffer.trim(),
        startLine: bufferStartLine,
        endLine: bufferStartLine + bufferLineCount - 1,
      });
    }

    currentLine += para.split('\n').length + 1;
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────
//  Carregar/Salvar Índice
// ─────────────────────────────────────────────────────────────

function getCacheDirPath(rootDir: string): string {
  return path.join(rootDir, CACHE_DIR);
}

function getIndexFilePath(rootDir: string): string {
  return path.join(getCacheDirPath(rootDir), INDEX_FILE);
}

async function saveIndex(
  rootDir: string,
  store: IndexStore
): Promise<void> {
  const cacheDir = getCacheDirPath(rootDir);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    getIndexFilePath(rootDir),
    JSON.stringify(store, null, 2),
    'utf-8'
  );
}

async function loadIndex(
  rootDir: string
): Promise<IndexStore | null> {
  try {
    const content = await fs.readFile(getIndexFilePath(rootDir), 'utf-8');
    return JSON.parse(content) as IndexStore;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Indexação de arquivos (brain do RAG)
// ─────────────────────────────────────────────────────────────

async function collectTextFiles(
  rootDir: string,
  fileReader: FileReader,
  maxFiles: number = 200
): Promise<string[]> {
  const all: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (all.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = await fileReader.readDir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (all.length >= maxFiles) break;
      const fullPath = path.join(dir, entry);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;

      if (stat.isDirectory()) {
        // Pula diretórios do sistema e node_modules
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
  }

  await walk(rootDir);
  return all.sort();
}

// ─────────────────────────────────────────────────────────────
//  Classe Principal: RAGManager
// ─────────────────────────────────────────────────────────────

export class RAGManager {
  private readonly fileReader: FileReader;
  private provider: OllamaProvider | null = null;
  private embedModel: string = 'all-minilm';

  // Cursors para o ReAct Loop
  private chunkCursor: number = 0;

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
  }

  /**
   * Conecta o RAGManager a um OllamaProvider.
   * Necessário para gerar embeddings.
   */
  connectProvider(provider: OllamaProvider): void {
    this.provider = provider;
  }

  /**
   * Garante que o índice existe para o diretório informado.
   * Se o cache estiver atualizado (mtime igual), reutiliza.
   * Se não, indexa apenas os arquivos modificados.
   *
   * Indexação é SEQUENCIAL (um embedding por vez) para não travar a RAM.
   *
   * @param rootDir  Diretório raiz para indexar
   */
  async ensureIndex(rootDir: string): Promise<void> {
    if (!this.provider) {
      throw new Error(
        'RAGManager: provider não conectado. ' +
        'Chame connectProvider() antes de ensureIndex().'
      );
    }

    const absoluteRoot = path.resolve(rootDir);
    const existingIndex = await loadIndex(absoluteRoot);
    const now = Date.now();

    // 1. Coleta arquivos (inclui DOCUMENTACAO_PROJETO.md sempre primeiro)
    const docPath = path.resolve('DOCUMENTACAO_PROJETO.md');
    const allFiles = await collectTextFiles(absoluteRoot, this.fileReader);

    // 2. Garante que DOCUMENTACAO_PROJETO.md esteja na lista
    const docExists = await fs.stat(docPath).then(() => true).catch(() => false);
    const filesToIndex: string[] = [];

    if (docExists) {
      // DOCUMENTACAO_PROJETO.md sempre é indexado primeiro (fonte prioritária)
      filesToIndex.push(docPath);
    }

    // Adiciona os arquivos do diretório, evitando duplicatas
    for (const f of allFiles) {
      if (f !== docPath) {
        // Verifica se é um path dentro do diretório raiz
        if (f.startsWith(absoluteRoot + path.sep) || f.startsWith(absoluteRoot)) {
          filesToIndex.push(f);
        }
      }
    }

    // 3. Verifica quais arquivos precisam ser (re)indexados
    const filesToProcess: string[] = [];

    for (const filePath of filesToIndex) {
      let stat: fsSync.Stats;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }

      const relPath = path.relative(absoluteRoot, filePath);
      const cachedMeta = existingIndex?.files?.[relPath];

      // Se o cache tem o arquivo e o mtime não mudou, pula
      if (cachedMeta && cachedMeta.mtime === stat.mtimeMs) {
        continue;
      }

      filesToProcess.push(filePath);
    }

    // Se não há arquivos para processar e já existe índice, usa o existente
    if (filesToProcess.length === 0 && existingIndex) {
      this.chunkCursor = existingIndex.chunks.length;
      return;
    }

    // 4. Indexa os arquivos novos/modificados (SEQUENCIAL, um por vez)
    const newChunks: ChunkEntry[] = [];

    for (const filePath of filesToProcess) {
      let content: string;
      try {
        content = await this.fileReader.readFile(filePath);
      } catch {
        continue;
      }

      // Pula binários (verificação rápida)
      if (!isTextContent(content)) {
        continue;
      }

      // Chunking
      const chunks = chunkText(content);
      if (chunks.length === 0) continue;

      const relPath = path.relative(absoluteRoot, filePath);

      // Gera embedding para cada chunk (SEQUENCIAL)
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const chunkId = `${relPath}#${ci}`;

        // Embedding via Ollama (sequencial, um por vez)
        let embedding: number[];
        try {
          embedding = await this.provider.embed(
            chunk.text,
            this.embedModel,
            '30s'  // keep_alive por 30s durante indexação em lote
          );
        } catch (err: any) {
          // Se falhou, pula este chunk (rede, timeout, etc.)
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

    // 5. Descarrega modelo de embedding (keep_alive=0 para liberar RAM)
    if (newChunks.length > 0 && this.provider) {
      try {
        await this.provider.embed('', this.embedModel, '0s');
      } catch {
        // Não falha se o descarregamento não funcionar
      }
    }

    // 6. Mescla com índice existente ou cria novo
    let finalChunks: ChunkEntry[];
    let finalFiles: Record<string, FileMeta>;

    if (existingIndex) {
      // Remove chunks de arquivos que foram reindexados
      const reindexedPaths = new Set(
        filesToProcess.map((f) => path.relative(absoluteRoot, f))
      );
      finalChunks = existingIndex.chunks.filter(
        (c) => !reindexedPaths.has(c.filePath)
      );
      finalChunks.push(...newChunks);

      finalFiles = { ...existingIndex.files };
      // Atualiza metadados
      for (const filePath of filesToProcess) {
        const relPath = path.relative(absoluteRoot, filePath);
        const relevantChunks = newChunks.filter((c) => c.filePath === relPath);
        let stat: fsSync.Stats | null;
        try {
          stat = await fs.stat(filePath);
        } catch {
          stat = null;
        }
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
        let stat: fsSync.Stats | null;
        try {
          stat = await fs.stat(filePath);
        } catch {
          stat = null;
        }
        finalFiles[relPath] = {
          mtime: stat ? stat.mtimeMs : now,
          chunks: relevantChunks.length,
        };
      }
    }

    // 7. Salva índice em disco
    const store: IndexStore = {
      formatVersion: 1,
      embedModel: this.embedModel,
      dimensions: 384,
      indexedAt: now,
      files: finalFiles,
      chunks: finalChunks,
    };

    await saveIndex(absoluteRoot, store);

    // Atualiza cursor (para o ReAct Loop saber quantos chunks existem)
    this.chunkCursor = finalChunks.length;
  }

  /**
   * Busca os TOP_K chunks mais similares à consulta.
   *
   * Etapas:
   *   1. Gera embedding da consulta
   *   2. Carrega índice do disco (se disponível)
   *   3. Calcula cosine similarity entre consulta e cada chunk
   *   4. Filtra por threshold, ordena por score, retorna TOP_K
   *
   * @param query     Texto da consulta (pergunta do usuário)
   * @param rootDir   Diretório raiz onde está o índice
   * @returns Lista de matches ordenados por relevância
   */
  async retrieve(
    query: string,
    rootDir: string
  ): Promise<SearchMatch[]> {
    if (!this.provider) {
      throw new Error('RAGManager: provider não conectado.');
    }

    const absoluteRoot = path.resolve(rootDir);

    // 1. Gera embedding da consulta (usa keep_alive=0 → descarrega imediatamente)
    const queryEmbedding = await this.provider.embed(
      query,
      this.embedModel,
      '0s'  // descarrega modelo de embedding imediatamente
    );

    // 2. Carrega índice do disco
    const store = await loadIndex(absoluteRoot);
    if (!store || store.chunks.length === 0) {
      return [];
    }

    // 3. Calcula similaridade para todos os chunks
    const scored = store.chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // 4. Filtra, ordena e retorna TOP_K
    return scored
      .filter((s) => s.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
  }

  /**
   * Formata os resultados da busca em um bloco de contexto para o prompt.
   */
  formatContext(
    matches: SearchMatch[],
    maxChars: number = 4000
  ): string {
    if (matches.length === 0) return '';

    let context = 'Documentos relevantes:\n\n';
    let used = context.length;

    for (const match of matches) {
      const header = `[${match.chunk.filePath}:${match.chunk.startLine}]`
      const entry = `${header}\n${match.chunk.text}\n\n---\n\n`;

      if (used + entry.length > maxChars) {
        // Limite de contexto: trunca
        const remaining = maxChars - used;
        if (remaining > 100) {
          context += entry.slice(0, remaining) + '\n... [truncado]\n';
        }
        break;
      }

      context += entry;
      used += entry.length;
    }

    return context.trim();
  }
}
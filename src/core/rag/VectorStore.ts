/**
 * VectorStore: Persistência do índice de embeddings em disco (SRP).
 *
 * Responsabilidade Única:
 * - Salvar/carregar o índice de chunks + embeddings em JSON
 * - Gerenciar metadados de arquivos (mtime para cache)
 * - Criar diretório de cache se necessário
 *
 * Não gera embeddings, não faz chunking, não busca.
 * Apenas I/O em disco.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const CACHE_DIR = '.soberano';
const INDEX_FILE = 'index.json';

/**
 * Um chunk de texto com metadados e embedding
 */
export interface ChunkEntry {
  id: string;
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
  embedding: number[];
  indexedAt: number;
}

interface FileMeta {
  mtime: number;
  chunks: number;
}

interface IndexStore {
  formatVersion: 1;
  embedModel: string;
  dimensions: number;
  indexedAt: number;
  files: Record<string, FileMeta>;
  chunks: ChunkEntry[];
}

export class VectorStore {
  /**
   * Salva o índice em disco.
   * Cria o diretório de cache automaticamente.
   */
  async save(rootDir: string, store: IndexStore): Promise<void> {
    const cacheDir = this.getCacheDir(rootDir);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      this.getIndexPath(rootDir),
      JSON.stringify(store, null, 2),
      'utf-8'
    );
  }

  /**
   * Carrega o índice do disco.
   * Retorna null se não existir (primeira execução).
   */
  async load(rootDir: string): Promise<IndexStore | null> {
    try {
      const content = await fs.readFile(this.getIndexPath(rootDir), 'utf-8');
      return JSON.parse(content) as IndexStore;
    } catch {
      return null;
    }
  }

  private getCacheDir(rootDir: string): string {
    return path.join(rootDir, CACHE_DIR);
  }

  private getIndexPath(rootDir: string): string {
    return path.join(this.getCacheDir(rootDir), INDEX_FILE);
  }
}
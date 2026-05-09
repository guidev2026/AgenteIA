import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';

export interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export class FileReader {
  /** Lê o conteúdo de um arquivo como string UTF-8 */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fsp.readFile(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read file "${filePath}": ${err.message}`);
    }
  }

  /** Lista os nomes das entradas (arquivos/diretórios) de um diretório */
  async readDir(dirPath: string): Promise<string[]> {
    try {
      return await fsp.readdir(dirPath);
    } catch (err: any) {
      throw new Error(`Failed to read directory "${dirPath}": ${err.message}`);
    }
  }

  /**
   * Busca recursivamente por arquivos cujo conteúdo corresponde a um padrão.
   * Retorna até `maxResults` ocorrências (padrão 100).
   */
  async searchFiles(
    rootDir: string,
    pattern: string | RegExp,
    maxResults: number = 100
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= maxResults) return;

      let entries: Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Silencia diretórios sem permissão
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = await fsp.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;
              if (regex.test(lines[i])) {
                results.push({
                  file: fullPath,
                  line: i + 1,
                  content: lines[i].trim(),
                });
              }
            }
          } catch {
            // Ignora arquivos binários ou sem permissão
          }
        }
      }
    };

    await walk(rootDir);
    return results;
  }
}
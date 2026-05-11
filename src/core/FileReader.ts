import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';

/**
 * Resultado de uma busca textual em arquivos.
 * Cada ocorrência contém o caminho do arquivo, número da linha e o texto encontrado.
 */
export interface SearchResult {
  file: string;
  line: number;
  content: string;
}

/**
 * FileReader: Camada de abstração sobre o sistema de arquivos do Node.js.
 *
 * Fluxo de dados:
 * CLI ──(path:string)──▶ readFile() ──(buffer)──▶ utf-8 string ──▶ console
 * CLI ──(dir:string)──▶ readDir() ──(Dirent[])──▶ string[] (nomes) ──▶ console
 * CLI ──(root+pattern)──▶ searchFiles() ──(walk recursivo)──▶ SearchResult[] ──▶ console
 *
 * Toda operação é assíncrona (Promise-based) para não bloquear o event loop.
 *
 * Segurança: Todos os métodos que acessam o sistema de arquivos usam
 * `resolveSecurePath` para prevenir Path Traversal (escapar do diretório do projeto).
 */
export class FileReader {
  /**
   * Resolve um caminho de usuário e valida que ele está dentro do diretório do projeto.
   *
   * Segurança contra Path Traversal (SEC-01, SEC-02):
   * 1. Resolve o caminho absoluto via path.resolve() a partir de process.cwd()
   * 2. Verifica se o caminho resolvido começa com o diretório raiz do projeto
   * 3. Se estiver fora (ex: ../../.ssh/id_rsa), lança erro
   *
   * @param userPath Caminho fornecido pelo usuário/agente (absoluto ou relativo)
   * @returns Caminho absoluto seguro dentro do projeto
   * @throws Error se o caminho resolvido estiver fora do diretório do projeto
   */
  static resolveSecurePath(userPath: string): string {
    const rootDir = process.cwd();
    const resolved = path.resolve(userPath);
    if (!resolved.startsWith(rootDir)) {
      throw new Error(
        `Acesso negado: O caminho "${resolved}" está fora do diretório do projeto "${rootDir}".`
      );
    }
    return resolved;
  }

  /**
   * Lê o conteúdo completo de um arquivo em disco.
   *
   * Pipeline:
   *   1. resolveSecurePath() → validação anti Path Traversal
   *   2. fsp.readFile(path, 'utf-8') → buffer binário decodificado como string
   *   3. Retorna a string diretamente
   *   4. Em caso de erro (arquivo inexistente, permissão), lança exceção
   *
   * @param filePath Caminho absoluto ou relativo do arquivo
   * @returns Conteúdo textual do arquivo
   */
  async readFile(filePath: string): Promise<string> {
    const safePath = FileReader.resolveSecurePath(filePath);
    try {
      return await fsp.readFile(safePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read file "${filePath}": ${err.message}`);
    }
  }

  /**
   * Lista as entradas (arquivos e subdiretórios) de um diretório.
   *
   * Pipeline:
   *   1. resolveSecurePath() → validação anti Path Traversal
   *   2. fsp.readdir(path) → array de nomes (somente strings, sem metadados)
   *   3. Retorna o array diretamente
   *
   * @param dirPath Caminho do diretório
   * @returns Array com os nomes dos arquivos/diretórios dentro de dirPath
   */
  async readDir(dirPath: string): Promise<string[]> {
    const safePath = FileReader.resolveSecurePath(dirPath);
    try {
      return await fsp.readdir(safePath);
    } catch (err: any) {
      throw new Error(`Failed to read directory "${dirPath}": ${err.message}`);
    }
  }

  /**
   * Busca recursiva em arquivos: percorre uma árvore de diretórios e encontra
   * linhas que casam com um padrão (string ou RegExp).
   *
   * Fluxo detalhado da recursão:
   *   1. Converte `pattern` string em RegExp com flag 'g' (global)
   *   2. `walk(dir)` é chamada recursivamente:
   *      a) fsp.readdir(dir, { withFileTypes: true }) → Dirent[] com metadados
   *      b) Para cada entry:
   *         - Se for diretório → walk(entry) (recursão)
   *         - Se for arquivo → lê conteúdo como utf-8, quebra em linhas,
   *           testa cada linha contra o regex
   *   3. Resultados são acumulados no array `results`
   *   4. Para quando atinge `maxResults` (padrão 100) para evitar consumo excessivo
   *
   * Tratamento de erros silencioso:
   *   - Diretórios sem permissão → ignorados (não interrompe a busca)
   *   - Arquivos binários (não UTF-8) → ignorados
   *
   * @param rootDir  Diretório raiz da busca
   * @param pattern  Padrão a buscar (string literal ou regex)
   * @param maxResults  Limite de ocorrências (padrão 100)
   * @returns Array de SearchResult ordenado por profundidade de descoberta
   */
  async searchFiles(
    rootDir: string,
    pattern: string | RegExp,
    maxResults: number = 100
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    // Converte string em RegExp — cada linha é testada individualmente.
    // Sem flag 'g' para evitar falsos negativos por lastIndex (RegExp global mantém estado interno).
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    /**
     * Função interna recursiva que percorre a árvore de diretórios.
     * Captura `results` e `maxResults` do closure externo via closure.
     */
    const walk = async (dir: string): Promise<void> => {
      // Early return: já atingimos o limite de resultados
      if (results.length >= maxResults) return;

      let entries: Dirent[];
      try {
        // withFileTypes: true → retorna objetos Dirent em vez de strings,
        // permitindo verificar isDirectory() / isFile() sem stat extra
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Silencia diretórios sem permissão de leitura
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break; // Early break

        // Constrói caminho absoluto juntando dir + nome da entrada
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Ramo recursivo: desce um nível na árvore
          await walk(fullPath);
        } else if (entry.isFile()) {
          try {
            // Lê o arquivo inteiro como string UTF-8
            const content = await fsp.readFile(fullPath, 'utf-8');
            // Divide em linhas (LF ou CRLF)
            const lines = content.split('\n');
            // Itera cada linha testando o regex
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;
              if (regex.test(lines[i])) {
                results.push({
                  file: fullPath,
                  line: i + 1,      // Linhas são 1-indexed
                  content: lines[i].trim(), // Remove espaços extras
                });
              }
            }
          } catch {
            // Ignora arquivos binários (não decodificáveis como UTF-8)
            // ou arquivos sem permissão de leitura
          }
        }
      }
    };

    // Inicia a recursão a partir do diretório raiz
    await walk(rootDir);
    return results;
  }
}
/**
 * SearchReplaceEditor — Edição por bloco exato com normalização.
 *
 * Estratégia:
 * 1. Lê o arquivo via FileReader
 * 2. Divide o conteúdo e o searchBlock em linhas
 * 3. Normaliza linha a linha (CRLF→LF, trimEnd)
 * 4. Busca um bloco contíguo de linhas normalizadas que case exatamente
 * 5. Se match único: substitui as linhas correspondentes no conteúdo original
 * 6. Se 0 matches: retorna falha (matchCount: 0)
 * 7. Se >1 matches: retorna falha (matchCount: N) sem substituir
 * 8. Escreve o arquivo modificado no disco
 */

import * as fsp from 'node:fs/promises';
import { FileReader } from './FileReader';

/**
 * Resultado da operação de busca e substituição.
 */
export interface SearchReplaceResult {
  /** true se a substituição foi bem-sucedida */
  success: boolean;
  /** Número de ocorrências do bloco de busca encontradas */
  matchCount: number;
  /** Caminho do arquivo alvo */
  filePath: string;
  /** Mensagem de erro em caso de falha */
  error?: string;
}

export class SearchReplaceEditor {
  private fileReader: FileReader;

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
  }

  /**
   * Normaliza uma única linha:
   * - Converte \r\n para \n (remove \r do final)
   * - Remove trailing whitespace
   * - Preserva indentação inicial
   */
  private normalizeLine(line: string): string {
    return line.replace(/\r$/, '').trimEnd();
  }

  /**
   * Normaliza o texto completo para comparação.
   */
  private normalize(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n');
  }

  /**
   * Aplica uma substituição de bloco exato no arquivo.
   *
   * A busca é feita no conteúdo normalizado (CRLF→LF, trimEnd por linha),
   * mas a substituição ocorre no conteúdo original, preservando
   * terminações de linha originais e whitespace.
   *
   * @param filePath    Caminho do arquivo a ser editado
   * @param searchBlock Bloco de texto a ser encontrado
   * @param replaceBlock Bloco de texto substituto
   * @returns SearchReplaceResult com o resultado da operação
   */
  async apply(
    filePath: string,
    searchBlock: string,
    replaceBlock: string
  ): Promise<SearchReplaceResult> {
    // 1. Ler o conteúdo original do arquivo
    let originalContent: string;
    try {
      originalContent = await this.fileReader.readFile(filePath);
    } catch (err: any) {
      return {
        success: false,
        matchCount: 0,
        filePath,
        error: `Falha ao ler arquivo "${filePath}": ${err.message}`,
      };
    }

    // 2. Dividir original e search em linhas
    const originalLines = originalContent.split('\n');
    const normalizedLines = originalLines.map(l => this.normalizeLine(l));

    const searchLines = this.normalize(searchBlock).split('\n');

    // 3. Se searchBlock vazio ou sem linhas, retorna falha
    if (searchLines.length === 0 || (searchLines.length === 1 && searchLines[0] === '')) {
      return {
        success: false,
        matchCount: 0,
        filePath,
        error: 'Bloco de busca vazio.',
      };
    }

    // 4. Encontrar todas as ocorrências do bloco normalizado
    const matches: number[] = [];
    const maxStart = normalizedLines.length - searchLines.length;

    for (let startIdx = 0; startIdx <= maxStart; startIdx++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (normalizedLines[startIdx + j] !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        matches.push(startIdx);
      }
    }

    const matchCount = matches.length;

    // 5. Validar número de matches
    if (matchCount === 0) {
      return {
        success: false,
        matchCount: 0,
        filePath,
        error: `Bloco de busca não encontrado no arquivo "${filePath}" (0 matches).`,
      };
    }

    if (matchCount > 1) {
      return {
        success: false,
        matchCount,
        filePath,
        error: `Bloco de busca encontrado ${matchCount} vezes no arquivo "${filePath}". Forneça um bloco de busca mais específico.`,
      };
    }

    // 6. Match único — substituir as linhas no conteúdo original
    const startLine = matches[0];
    const endLine = startLine + searchLines.length;

    // Constrói o novo conteúdo:
    // - Linhas antes do match (preservando originais)
    // - Bloco de substituição (texto exato fornecido pelo usuário)
    // - Linhas após o match (preservando originais)
    const beforeLines = originalLines.slice(0, startLine);
    const afterLines = originalLines.slice(endLine);

    const replaceLines = replaceBlock.split('\n');
    const newContent = [...beforeLines, ...replaceLines, ...afterLines].join('\n');

    // 7. Validar caminho (Path Traversal) e escrever o arquivo
    try {
      const safePath = await FileReader.resolveSecurePath(filePath);
      await fsp.writeFile(safePath, newContent, 'utf-8');
    } catch (err: any) {
      return {
        success: false,
        matchCount: 1,
        filePath,
        error: `Falha ao escrever arquivo "${filePath}": ${err.message}`,
      };
    }

    return {
      success: true,
      matchCount: 1,
      filePath,
    };
  }
}
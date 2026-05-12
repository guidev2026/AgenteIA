/**
 * ASTEditor: Edição estrutural de arquivos TypeScript por nome de símbolo.
 *
 * Permite substituir o corpo de uma declaração (função, classe, interface,
 * variável, etc.) em arquivos .ts mantendo o restante do arquivo intacto.
 *
 * Dependências (DIP):
 * - FileReader: leitura do arquivo fonte
 * - fs.writeFile (nativo): escrita do arquivo modificado
 *
 * Uso:
 *   const editor = new ASTEditor(fileReader);
 *   const result = await editor.replaceSymbol('src/foo.ts', 'myFunction', '...new code...');
 */

import * as ts from 'typescript';
import * as fs from 'node:fs/promises';
import { FileReader } from './FileReader';
import { findTopLevelSymbol } from './astUtils';

/**
 * Resultado de uma operação de substituição de símbolo.
 */
export interface ASTEditResult {
  /** true se a operação foi concluída sem erros */
  success: boolean;
  /** true se o símbolo foi encontrado no arquivo */
  symbolFound: boolean;
  /** Caminho do arquivo alvo */
  filePath: string;
  /** Nome do símbolo procurado */
  symbolName: string;
  /** Mensagem de erro, se houver */
  error?: string;
}

export class ASTEditor {
  /**
   * @param fileReader Instância de FileReader para ler arquivos do disco
   */
  constructor(private readonly fileReader: FileReader) {}

  /**
   * Substitui o código de um símbolo top-level em um arquivo TypeScript.
   *
   * Pipeline:
   *   1. Lê o arquivo via FileReader.readFile()
   *   2. Parseia com ts.createSourceFile()
   *   3. Busca o nó top-level cujo nome corresponda a symbolName
   *   4. Se encontrado, substitui o trecho (node.getFullStart() a node.getEnd())
   *      por newCode
   *   5. Escreve o resultado de volta no arquivo via fs.writeFile()
   *
   * @param filePath Caminho do arquivo .ts a editar
   * @param symbolName Nome do símbolo top-level a substituir
   * @param newCode Novo código fonte para substituir o símbolo
   * @returns ASTEditResult indicando sucesso/falha
   */
  async replaceSymbol(
    filePath: string,
    symbolName: string,
    newCode: string
  ): Promise<ASTEditResult> {
    const baseResult: Partial<ASTEditResult> = {
      filePath,
      symbolName,
    };

    // 1. Ler o arquivo
    let source: string;
    try {
      source = await this.fileReader.readFile(filePath);
    } catch (err: any) {
      return {
        ...baseResult,
        success: false,
        symbolFound: false,
        error: err.message,
      } as ASTEditResult;
    }

    // 2. Parsear com TypeScript
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    // 3. Buscar o símbolo top-level
    const node = findTopLevelSymbol(sourceFile, symbolName);

    if (!node) {
      return {
        ...baseResult,
        success: false,
        symbolFound: false,
        error: `Symbol "${symbolName}" not found in "${filePath}"`,
      } as ASTEditResult;
    }

    // 4. Calcular offsets e construir novo conteúdo
    const fullStart = node.getFullStart(); // includes leading comments/whitespace
    const end = node.getEnd();

    const newContent =
      source.slice(0, fullStart) +
      newCode +
      source.slice(end);

    // 5. Validar caminho (Path Traversal) e escrever o arquivo modificado
    try {
      const safePath = await FileReader.resolveSecurePath(filePath);
      await fs.writeFile(safePath, newContent, 'utf-8');
    } catch (err: any) {
      return {
        ...baseResult,
        success: false,
        symbolFound: true,
        error: `Failed to write file "${filePath}": ${err.message}`,
      } as ASTEditResult;
    }

    return {
      ...baseResult,
      success: true,
      symbolFound: true,
    } as ASTEditResult;
  }
}
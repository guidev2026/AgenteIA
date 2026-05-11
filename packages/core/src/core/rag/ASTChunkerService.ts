/**
 * ASTChunkerService: Chunking estrutural baseado em AST (SRP, DIP).
 *
 * Responsabilidade Única:
 * - Decidir se usa AST ou fallback textual baseado na extensão do arquivo
 * - Delegar parse para IASTParser (abstração — DIP)
 * - Transformar ASTNode[] em ChunkResult[] com respeito a limites de tamanho
 * - Subdividir nós grandes (ex: classes com muitos métodos) preservando
 *   blocos sintáticos completos
 *
 * Depende de IASTParser (interface) e IChunker (interface para fallback).
 * NÃO depende de nenhuma implementação concreta de parser.
 */

import type { IChunker, ChunkResult } from './IChunker';
import type { IASTParser, ASTNode } from './IASTParser';

const MAX_CHUNK_SIZE = 2000;         // caracteres máximos por chunk
const MAX_CHUNKS_PER_FILE = 50;      // limite máximo de chunks por arquivo

// Extensões que suportam parseamento AST
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

export class ASTChunkerService implements IChunker {
  constructor(
    private readonly astParser: IASTParser,
    private readonly fallbackChunker: IChunker
  ) {}

  /**
   * Divide o conteúdo usando AST para arquivos de código,
   * ou fallback textual para os demais formatos.
   *
   * @param content Conteúdo do arquivo
   * @param filePath Caminho (opcional — usado para detectar extensão)
   * @returns Array de chunks semanticamente coesos
   */
  chunk(content: string, filePath?: string): ChunkResult[] {
    // Se não tem filePath ou não é arquivo de código, usa fallback textual
    if (!filePath || !this.isCodeFile(filePath)) {
      return this.fallbackChunker.chunk(content);
    }

    // Tenta parse AST
    const astNodes = this.astParser.parse(content);

    // Se o parse falhou (código inválido), usa fallback
    if (astNodes.length === 0) {
      return this.fallbackChunker.chunk(content);
    }

    // Converte nós AST em chunks, respeitando limites
    return this.nodesToChunks(astNodes, content);
  }

  /**
   * Verifica se a extensão do arquivo é de código-processável por AST.
   */
  private isCodeFile(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return CODE_EXTENSIONS.has(ext);
  }

  /**
   * Extrai extensão do arquivo (incluindo o ponto).
   */
  private getExtension(filePath: string): string {
    const dotIndex = filePath.lastIndexOf('.');
    if (dotIndex === -1) return '';
    // Pega a extensão: ".ts", ".js", etc.
    return filePath.slice(dotIndex).toLowerCase();
  }

  /**
   * Converte nós AST em ChunkResult[] com as regras:
   * 1. Nó pequeno (≤ MAX_CHUNK_SIZE) → 1 chunk
   * 2. Nó grande do tipo ClassDeclaration → subdivide por métodos
   * 3. Outros nós grandes → chunk por linhas respeitando MAX_CHUNK_SIZE
   * 4. Respeita MAX_CHUNKS_PER_FILE
   */
  private nodesToChunks(nodes: ASTNode[], _source: string): ChunkResult[] {
    const chunks: ChunkResult[] = [];

    for (const node of nodes) {
      if (chunks.length >= MAX_CHUNKS_PER_FILE) break;

      if (node.text.length <= MAX_CHUNK_SIZE) {
        chunks.push({
          text: node.text,
          startLine: node.startLine,
          endLine: node.endLine,
        });
      } else if (node.kind === 'ClassDeclaration') {
        // Para classes grandes: chunk da classe + chunk de cada método
        this.splitLargeClass(node, chunks);
      } else {
        // Para outros nós grandes: divide por linhas
        this.splitLargeNode(node, chunks);
      }
    }

    return chunks;
  }

  /**
   * Subdivide uma classe grande: primeiro a assinatura da classe,
   * depois cada método como chunk independente.
   */
  private splitLargeClass(node: ASTNode, chunks: ChunkResult[]): void {
    if (chunks.length >= MAX_CHUNKS_PER_FILE) return;

    // Extrai a assinatura da classe (até a primeira {)
    const braceIndex = node.text.indexOf('{');
    const signature = braceIndex !== -1
      ? node.text.substring(0, braceIndex + 1) + '\n  // ... (methods below)\n}'
      : node.text;

    chunks.push({
      text: signature,
      startLine: node.startLine,
      endLine: node.startLine + signature.split('\n').length - 1,
    });

    if (chunks.length >= MAX_CHUNKS_PER_FILE) return;

    // Encontra métodos dentro do texto da classe usando regex simples
    const methodRegex = /^\s+(async\s+)?(static\s+)?(get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*{/gm;
    let match: RegExpExecArray | null;

    while ((match = methodRegex.exec(node.text)) !== null) {
      if (chunks.length >= MAX_CHUNKS_PER_FILE) break;

      // Acha o fim do método contando chaves aninhadas
      const methodStart = match.index;
      let depth = 0;
      let pos = methodStart;
      let methodEnd = methodStart;

      for (let i = methodStart; i < node.text.length; i++) {
        if (node.text[i] === '{') depth++;
        if (node.text[i] === '}') {
          depth--;
          if (depth === 0) {
            methodEnd = i + 1;
            break;
          }
        }
      }

      const methodText = node.text.substring(methodStart, methodEnd);
      const relativeLineOffset = node.startLine - 1;

      chunks.push({
        text: methodText.trim(),
        startLine: relativeLineOffset + node.text.substring(0, methodStart).split('\n').length,
        endLine: relativeLineOffset + node.text.substring(0, methodEnd).split('\n').length,
      });
    }
  }

  /**
   * Subdivide um nó grande que não é classe
   * em chunks menores respeitando MAX_CHUNK_SIZE.
   */
  private splitLargeNode(node: ASTNode, chunks: ChunkResult[]): void {
    const lines = node.text.split('\n');
    let buffer = '';
    let bufferStartLine = node.startLine;
    let bufferLineCount = 0;

    for (let i = 0; i < lines.length && chunks.length < MAX_CHUNKS_PER_FILE; i++) {
      const line = lines[i];
      const candidate = buffer ? buffer + '\n' + line : line;

      if (candidate.length > MAX_CHUNK_SIZE && buffer) {
        chunks.push({
          text: buffer.trim(),
          startLine: bufferStartLine,
          endLine: bufferStartLine + bufferLineCount - 1,
        });

        buffer = line;
        bufferStartLine = node.startLine + i;
        bufferLineCount = 1;
      } else {
        buffer = candidate;
        bufferLineCount++;
      }
    }

    if (buffer.trim() && chunks.length < MAX_CHUNKS_PER_FILE) {
      chunks.push({
        text: buffer.trim(),
        startLine: bufferStartLine,
        endLine: bufferStartLine + bufferLineCount - 1,
      });
    }
  }
}
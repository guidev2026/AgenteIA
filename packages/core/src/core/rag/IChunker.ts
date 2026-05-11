/**
 * IChunker: Interface para o contrato de chunking (DIP).
 *
 * Permite que o RAGManager dependa de uma abstração em vez de
 * uma implementação concreta de chunking. Suporta tanto chunking
 * textual (por parágrafo/sentença) quanto estrutural (AST-aware).
 *
 * O parâmetro opcional `filePath` permite que implementações
 * adaptem a estratégia com base na extensão do arquivo.
 */

export interface ChunkResult {
  text: string;
  startLine: number;
  endLine: number;
}

export interface IChunker {
  /**
   * Divide o conteúdo em chunks semanticamente coerentes.
   *
   * @param content Conteúdo completo do arquivo
   * @param filePath Caminho do arquivo (opcional, usado para detectar
   *                 extensão e adaptar estratégia de chunking)
   * @returns Array de chunks com metadados de linha
   */
  chunk(content: string, filePath?: string): ChunkResult[];
}
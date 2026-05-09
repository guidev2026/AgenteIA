/**
 * Chunker: Responsável apenas por dividir textos em chunks (SRP).
 *
 * Estratégias de chunking:
 * - Por parágrafo (\n\n): divisão semântica padrão
 * - Por sentença (. ? !): fallback para parágrafos longos
 * - Com overlap entre chunks consecutivos
 *
 * É uma função pura — sem estado, sem I/O. Ideal para testes.
 */

const MAX_CHUNK_SIZE = 2000;        // caracteres (~500 tokens)
const OVERLAP = 200;                 // sobreposição entre chunks
const MAX_CHUNKS_PER_FILE = 50;     // limite por arquivo

export interface ChunkResult {
  text: string;
  startLine: number;
  endLine: number;
}

export class Chunker {
  /**
   * Divide o conteúdo de um arquivo em chunks semanticamente coerentes.
   *
   * Algoritmo:
   * 1. Divide o texto em parágrafos (separados por \n\n)
   * 2. Se o parágrafo cabe em MAX_CHUNK_SIZE, usa como chunk
   * 3. Se não, divide por sentenças
   * 4. Aplica overlap de OVERLAP caracteres entre chunks consecutivos
   * 5. Respeita MAX_CHUNKS_PER_FILE
   *
   * @param content Conteúdo completo do arquivo
   * @returns Array de chunks com metadados de linha
   */
  chunk(content: string): ChunkResult[] {
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
}
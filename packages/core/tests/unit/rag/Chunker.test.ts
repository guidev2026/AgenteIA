import { describe, it, expect } from 'vitest';
import { Chunker } from '../../../src/core/rag/Chunker';

/**
 * Testes unitários para Chunker.
 *
 * Função pura, sem dependências, sem I/O.
 * Zero consumo de CPU além do necessário.
 */

describe('Chunker', () => {
  const chunker = new Chunker();

  it('divide conteúdo em chunks por parágrafo', () => {
    const content = 'Parágrafo um.\n\nParágrafo dois.\n\nParágrafo três.';
    const chunks = chunker.chunk(content);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toContain('Parágrafo um');
    expect(chunks[1].text).toContain('Parágrafo dois');
    expect(chunks[2].text).toContain('Parágrafo três');
  });

  it('retorna array vazio para conteúdo vazio', () => {
    expect(chunker.chunk('')).toEqual([]);
  });

  it('retorna array vazio para texto com apenas whitespace', () => {
    expect(chunker.chunk('  \n\n  \n  ')).toEqual([]);
  });

  it('atribui startLine/endLine corretamente', () => {
    const content = 'Linha1\nLinha2\n\nLinha3\nLinha4';
    const chunks = chunker.chunk(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(2);
    expect(chunks[1].startLine).toBe(4); // +1 pelo \n\n
    expect(chunks[1].endLine).toBe(5);
  });

  it('divide parágrafo longo por sentenças', () => {
    // Cria um texto longo com sentenças reais (com pontuação para split funcionar)
    const sentence = 'Isto é uma sentença longa com várias palavras para testar o chunking do algoritmo. ';
    const longParagraph = sentence.repeat(60); // ~6000 chars, > 2000
    const chunks = chunker.chunk(longParagraph);

    // Deve ter gerado múltiplos chunks
    expect(chunks.length).toBeGreaterThan(1);
    // Cada chunk (exceto talvez o último) deve ter no máximo 2000 chars
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].text.length).toBeLessThanOrEqual(2000);
    }
  });

  it('respeita limite de MAX_CHUNKS_PER_FILE (50)', () => {
    // Conteúdo com 60 parágrafos
    const paragraphs = Array.from({ length: 60 }, (_, i) => `Parágrafo ${i + 1}.`);
    const content = paragraphs.join('\n\n');

    const chunks = chunker.chunk(content);
    expect(chunks.length).toBeLessThanOrEqual(50);
  });

  it('ignora parágrafos vazios', () => {
    const content = 'Primeiro.\n\n\n\nSegundo.';
    const chunks = chunker.chunk(content);

    expect(chunks).toHaveLength(2);
  });

  it('chunk único para texto pequeno', () => {
    const content = 'Texto pequeno.';
    const chunks = chunker.chunk(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Texto pequeno.');
  });
});
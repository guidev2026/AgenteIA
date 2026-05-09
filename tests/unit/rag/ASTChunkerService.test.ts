/**
 * Tests for ASTChunkerService
 *
 * Validações:
 * - Chunk de arquivo .ts usa AST; .md usa fallback textual
 * - AST parse bem-sucedido gera chunks baseados em nós semânticos
 * - Nós pequenos (≤ MAX_CHUNK_SIZE) geram 1 chunk cada
 * - Classe grande é subdividida em signature + métodos
 * - Nó grande não-classe é dividido por linhas respeitando MAX_CHUNK_SIZE
 * - Fallback textual para código inválido ou sem extensão reconhecida
 * - Fallback para parse que retorna array vazio
 * - Respeita MAX_CHUNKS_PER_FILE (não explode com arquivo gigante)
 */

import { describe, it, expect, vi } from 'vitest';
import { ASTChunkerService } from '../../../src/core/rag/ASTChunkerService';
import type { IChunker, ChunkResult } from '../../../src/core/rag/IChunker';
import type { IASTParser, ASTNode } from '../../../src/core/rag/IASTParser';

// Factory helper
function createService(params?: {
  astParser?: IASTParser;
  fallbackChunker?: IChunker;
}): ASTChunkerService {
  const astParser = params?.astParser ?? {
    parse: (_source: string): ASTNode[] => [],
  };
  const fallbackChunker = params?.fallbackChunker ?? {
    chunk: (content: string, _filePath?: string): ChunkResult[] => [
      { text: content, startLine: 1, endLine: content.split('\n').length },
    ],
  };
  return new ASTChunkerService(astParser, fallbackChunker);
}

describe('ASTChunkerService', () => {
  describe('chunk — extension routing', () => {
    it('should use AST for .ts files', () => {
      const astSpy = vi.fn<(...args: Parameters<IASTParser['parse']>) => ReturnType<IASTParser['parse']>>();
      astSpy.mockReturnValue([
        { name: 'foo', kind: 'FunctionDeclaration', text: 'function foo() {}', startLine: 1, endLine: 1 },
      ]);

      const fallbackMock = vi.fn();
      const fallback: IChunker = { chunk: fallbackMock };

      const svc = createService({ astParser: { parse: astSpy }, fallbackChunker: fallback });
      const result = svc.chunk('function foo() {}', 'file.ts');

      expect(astSpy).toHaveBeenCalledTimes(1);
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('should use AST for .tsx, .js, .jsx, .mjs, .cjs', () => {
      const astSpy = vi.fn<(...args: Parameters<IASTParser['parse']>) => ReturnType<IASTParser['parse']>>();
      astSpy.mockReturnValue([
        { name: 'x', kind: 'FunctionDeclaration', text: 'function x() {}', startLine: 1, endLine: 1 },
      ]);

      const fallback: IChunker = { chunk: (c) => [{ text: c, startLine: 1, endLine: 1 }] };

      const svc = createService({ astParser: { parse: astSpy }, fallbackChunker: fallback });

      for (const ext of ['.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
        astSpy.mockClear();
        svc.chunk('function x() {}', `file${ext}`);
        expect(astSpy).toHaveBeenCalledTimes(1);
      }
    });

    it('should use fallback for non-code extensions', () => {
      const astSpy = vi.fn();
      const fallbackSpy = vi.fn<(...args: Parameters<IChunker['chunk']>) => ReturnType<IChunker['chunk']>>();
      fallbackSpy.mockReturnValue([{ text: 'fallback', startLine: 1, endLine: 1 }]);

      const svc = createService({
        astParser: { parse: astSpy },
        fallbackChunker: { chunk: fallbackSpy },
      });

      const result = svc.chunk('some content', 'readme.md');

      expect(astSpy).not.toHaveBeenCalled();
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(result[0].text).toBe('fallback');
    });

    it('should use fallback when no filePath is provided', () => {
      const astSpy = vi.fn();
      const fallbackSpy = vi.fn<(...args: Parameters<IChunker['chunk']>) => ReturnType<IChunker['chunk']>>();
      fallbackSpy.mockReturnValue([{ text: 'fallback', startLine: 1, endLine: 1 }]);

      const svc = createService({
        astParser: { parse: astSpy },
        fallbackChunker: { chunk: fallbackSpy },
      });

      const result = svc.chunk('some content');

      expect(astSpy).not.toHaveBeenCalled();
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(result[0].text).toBe('fallback');
    });
  });

  describe('chunk — AST parse results', () => {
    it('should convert AST nodes to chunks for small nodes', () => {
      const astParser: IASTParser = {
        parse: () => [
          { name: 'foo', kind: 'FunctionDeclaration', text: 'function foo() {}', startLine: 1, endLine: 1 },
          { name: 'bar', kind: 'FunctionDeclaration', text: 'function bar() {}', startLine: 3, endLine: 3 },
        ],
      };

      const svc = createService({ astParser });
      const result = svc.chunk('...', 'test.ts');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ text: 'function foo() {}', startLine: 1, endLine: 1 });
      expect(result[1]).toMatchObject({ text: 'function bar() {}', startLine: 3, endLine: 3 });
    });

    it('should fallback when AST returns empty array', () => {
      const astParser: IASTParser = {
        parse: () => [],
      };
      const fallbackSpy = vi.fn<(...args: Parameters<IChunker['chunk']>) => ReturnType<IChunker['chunk']>>();
      fallbackSpy.mockReturnValue([{ text: 'fallback', startLine: 1, endLine: 1 }]);

      const svc = createService({ astParser, fallbackChunker: { chunk: fallbackSpy } });
      svc.chunk('some content', 'test.ts');

      expect(fallbackSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('chunk — large class subdivision', () => {
    it('should split class with multiple methods into signature + method chunks', () => {
      // Classe precisa ter > 2000 chars para entrar no splitLargeClass
      const methods: string[] = [];
      for (let i = 0; i < 60; i++) {
        methods.push(`  method${i}() { return "x".repeat(${i * 30}); }`);
      }
      const classText = [
        'class LargeService {',
        ...methods,
        '}',
      ].join('\n');

      // Garantir que classe tem > 2000 chars
      expect(classText.length).toBeGreaterThan(2000);

      const astParser: IASTParser = {
        parse: () => [
          {
            name: 'LargeService',
            kind: 'ClassDeclaration',
            text: classText,
            startLine: 1,
            endLine: 2 + methods.length, // 2 = class header + footer
          },
        ],
      };

      const svc = createService({ astParser });
      const result = svc.chunk(classText, 'test.ts');

      // Deve ter pelo menos signature + métodos
      expect(result.length).toBeGreaterThanOrEqual(3);

      // Primeiro chunk = assinatura da classe
      expect(result[0].text).toContain('class LargeService');
      expect(result[0].text).toContain('(methods below)');

      // Deve ter método method0
      const method0Chunk = result.find((c) => c.text.includes('method0'));
      expect(method0Chunk).toBeDefined();
    });
  });

  describe('chunk — large non-class node subdivision', () => {
    it('should split a large function into multiple chunks', () => {
      // Gera uma função grande com > 2000 chars
      const lines: string[] = ['function huge() {'];
      for (let i = 0; i < 80; i++) {
        lines.push(`  const x${i} = "this is line number ${i} with enough padding to make it longer";`);
      }
      lines.push('}');
      const bigText = lines.join('\n');

      const astParser: IASTParser = {
        parse: () => [
          {
            name: 'huge',
            kind: 'FunctionDeclaration',
            text: bigText,
            startLine: 1,
            endLine: lines.length,
          },
        ],
      };

      const svc = createService({ astParser });
      const result = svc.chunk(bigText, 'test.ts');

      // Deve ter dividido em múltiplos chunks
      expect(result.length).toBeGreaterThan(1);

      // Todos os chunks juntos devem manter o conteúdo original
      const allText = result.map((c) => c.text).join('\n');
      expect(allText).toContain('function huge()');
    });
  });

  describe('chunk — MAX_CHUNKS_PER_FILE limit', () => {
    it('should not exceed MAX_CHUNKS_PER_FILE (50)', () => {
      // Gera 60 nós pequenos
      const nodes: ASTNode[] = [];
      for (let i = 0; i < 60; i++) {
        nodes.push({
          name: `fn${i}`,
          kind: 'FunctionDeclaration',
          text: `function fn${i}() { return ${i}; }`,
          startLine: i + 1,
          endLine: i + 1,
        });
      }

      const astParser: IASTParser = { parse: () => nodes };
      const svc = createService({ astParser });
      const result = svc.chunk('...', 'test.ts');

      expect(result.length).toBeLessThanOrEqual(50);
    });
  });
});
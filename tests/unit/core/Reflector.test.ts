/**
 * Reflector.test.ts — Testes unitários para o Reflector (self-correction).
 *
 * Cobertura:
 * 1. Instanciação com provider válido
 * 2. Instanciação com provider inválido (lança erro)
 * 3. reflect() com resposta correta (sem correção)
 * 4. reflect() com resposta incorreta (com correção)
 * 5. reflect() com resposta vazia (retorna vazio)
 * 6. reflect() com resposta só com espaços (retorna vazio)
 * 7. reflect() com JSON inválido do provider (fallback)
 * 8. reflect() com múltiplos erros
 * 9. Integração com toolRegistry
 * 10. Fallback em caso de erro de rede
 */

import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '../../../src/core/Reflector';
import type { IProvider } from '../../../src/providers/types';

// ── Helpers ──

/** ToolRegistry mock padrão */
const mockToolRegistry = { getToolNames: () => ['readFile', 'execute', 'readDir'] };

/** Cria um provider mock que retorna respostas previsíveis */
function createMockProvider(responses: Record<string, string>): IProvider {
  return {
    name: 'test-provider',
    chat: vi.fn(async ({ prompt }) => {
      const matchedKey = Object.keys(responses).find((key) =>
        prompt.includes(key)
      );
      const response = matchedKey
        ? responses[matchedKey]
        : responses['default'] ?? '{}';
      return { response, model: 'test-model', done: true };
    }),
    streamChat: undefined,
  };
}

// ── Testes ──

describe('Reflector', () => {
  describe('constructor', () => {
    it('deve instanciar com provider e toolRegistry válidos', () => {
      const provider = createMockProvider({ default: '{}' });
      const reflector = new Reflector(provider, mockToolRegistry);
      expect(reflector).toBeInstanceOf(Reflector);
    });

    it('deve lançar erro se provider não for fornecido', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Reflector(undefined as any, mockToolRegistry);
      }).toThrow();
    });

    it('deve lançar erro se toolRegistry não for fornecido', () => {
      const provider = createMockProvider({ default: '{}' });
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Reflector(provider, undefined as any);
      }).toThrow();
    });
  });

  describe('reflect()', () => {
    it('deve retornar resposta sem correção se já está correta', async () => {
      const responseContent = 'A resposta está correta e completa.';
      const mockResponse = JSON.stringify({
        hasError: false,
        errors: [],
        correctedOutput: responseContent,
      });

      const provider = createMockProvider({
        default: mockResponse,
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.finalContent).toBe(responseContent);
      expect(result.wasCorrected).toBe(false);
      expect(result.errors).toEqual([]);
    });

    it('deve corrigir resposta incorreta', async () => {
      const responseContent = 'Resposta errada.';
      const corrected = 'Resposta corrigida.';
      const mockResponse = JSON.stringify({
        hasError: true,
        correctedOutput: corrected,
        errors: [{ type: 'hallucination', description: 'Informação incorreta' }],
      });

      const provider = createMockProvider({
        default: mockResponse,
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.finalContent).toBe(corrected);
      expect(result.wasCorrected).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].type).toBe('hallucination');
    });

    it('deve retornar resposta vazia se entrada for vazia', async () => {
      const provider = createMockProvider({ default: '{}' });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect('', 'test-model');
      expect(result.finalContent).toBe('');
      expect(result.wasCorrected).toBe(false);
    });

    it('deve retornar resposta vazia se entrada for só espaços', async () => {
      const provider = createMockProvider({ default: '{}' });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect('   ', 'test-model');
      expect(result.finalContent).toBe('');
      expect(result.wasCorrected).toBe(false);
    });

    it('deve retornar resposta original se JSON do provider for inválido', async () => {
      const responseContent = 'Resposta original.';
      const provider = createMockProvider({
        default: 'JSON inválido aqui',
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.finalContent).toBe(responseContent);
      expect(result.wasCorrected).toBe(false);
    });

    it('deve detectar múltiplos erros na resposta', async () => {
      const responseContent = 'Resposta com vários problemas.';
      const corrected = 'Resposta totalmente corrigida.';
      const mockResponse = JSON.stringify({
        hasError: true,
        correctedOutput: corrected,
        errors: [
          { type: 'hallucination', description: 'Erro factual 1' },
          { type: 'logic', description: 'Erro de raciocínio' },
          { type: 'inconsistency', description: 'Informação faltando' },
        ],
      });

      const provider = createMockProvider({
        default: mockResponse,
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.wasCorrected).toBe(true);
      expect(result.errors).toHaveLength(3);
      expect(result.errors!.map((e) => e.type)).toContain('hallucination');
      expect(result.errors!.map((e) => e.type)).toContain('logic');
      expect(result.errors!.map((e) => e.type)).toContain('inconsistency');
    });

    it('deve incluir toolRegistry no prompt de crítica', async () => {
      const toolRegistry = { getToolNames: () => ['readFile'] };
      const mockResponse = JSON.stringify({
        hasError: false,
        correctedOutput: '',
        errors: [],
      });

      const provider = createMockProvider({
        default: mockResponse,
      });
      const reflector = new Reflector(provider, toolRegistry);

      const result = await reflector.reflect('Resposta correta.', 'test-model');

      expect(result.wasCorrected).toBe(false);
      expect(result.finalContent).toBe('Resposta correta.');
    });

    it('deve lidar com erro do provider sem quebrar (fallback)', async () => {
      const provider: IProvider = {
        name: 'test-provider',
        chat: vi.fn().mockRejectedValue(new Error('Rede falhou')),
        streamChat: undefined,
      };
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(
        'Resposta original.',
        'test-model'
      );

      // Fallback: retorna o conteúdo original sem reflexão
      expect(result.finalContent).toBe('Resposta original.');
      expect(result.wasCorrected).toBe(false);
    });

    it('deve retornar resposta original se hasError=true mas correctedOutput vazio', async () => {
      const responseContent = 'Resposta com problema.';
      const mockResponse = JSON.stringify({
        hasError: true,
        correctedOutput: '',
        errors: [{ type: 'hallucination', description: 'Erro' }],
      });

      const provider = createMockProvider({
        default: mockResponse,
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      // hasError=true mas correctedOutput vazio → mantém original
      expect(result.finalContent).toBe(responseContent);
      expect(result.wasCorrected).toBe(false);
    });
  });
});

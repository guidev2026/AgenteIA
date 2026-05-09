/**
 * Reflector.test.ts — Testes unitários para o Reflector (self-correction).
 *
 * Cobertura:
 * 1. Instanciação com critiqueProvider válido
 * 2. Instanciação com critiqueProvider inválido (lança erro)
 * 3. reflect() com resposta correta (stable)
 * 4. reflect() com resposta incorreta (corrected → stable)
 * 5. reflect() com resposta vazia (stable)
 * 6. reflect() com resposta só com espaços (stable)
 * 7. reflect() com JSON inválido do provider (fallback → rejected)
 * 8. reflect() com múltiplos erros
 * 9. Integração com toolRegistry
 * 10. Fallback em caso de erro de rede (rejected)
 * 11. correctedOutput vazio com hasError=true (mantém original)
 */

import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '../../../src/core/Reflector';
import type { ICritiqueProvider } from '../../../src/providers/types';

// ── Helpers ──

/** ToolRegistry mock padrão */
const mockToolRegistry = { getToolNames: () => ['readFile', 'execute', 'readDir'] };

/** Cria um critiqueProvider mock que retorna respostas previsíveis */
function createMockCritiqueProvider(
  responses: Record<string, { parsedJson: Record<string, unknown>; rawText: string }>
): ICritiqueProvider {
  return {
    name: 'test-critique-provider',
    critique: vi.fn(async ({ prompt }) => {
      const matchedKey = Object.keys(responses).find((key) =>
        prompt.includes(key)
      );
      const response = matchedKey
        ? responses[matchedKey]
        : responses['default'] ?? { parsedJson: {}, rawText: '{}' };
      return response;
    }),
  };
}

// ── Testes ──

describe('Reflector', () => {
  describe('constructor', () => {
    it('deve instanciar com critiqueProvider e toolRegistry válidos', () => {
      const provider = createMockCritiqueProvider({
        default: { parsedJson: {}, rawText: '{}' },
      });
      const reflector = new Reflector(provider, mockToolRegistry);
      expect(reflector).toBeInstanceOf(Reflector);
    });

    it('deve lançar erro se critiqueProvider não for fornecido', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Reflector(undefined as any, mockToolRegistry);
      }).toThrow();
    });

    it('deve lançar erro se toolRegistry não for fornecido', () => {
      const provider = createMockCritiqueProvider({
        default: { parsedJson: {}, rawText: '{}' },
      });
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Reflector(provider, undefined as any);
      }).toThrow();
    });
  });

  describe('reflect()', () => {
    it('deve retornar resposta sem correção se já está correta', async () => {
      const responseContent = 'A resposta está correta e completa.';

      const provider = createMockCritiqueProvider({
        default: {
          parsedJson: {
            hasError: false,
            errors: [],
            correctedOutput: responseContent,
          },
          rawText: JSON.stringify({
            hasError: false,
            errors: [],
            correctedOutput: responseContent,
          }),
        },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.finalContent).toBe(responseContent);
      expect(result.correctionStatus).toBe('stable');
      expect(result.errors).toEqual([]);
    });

    it('deve corrigir resposta incorreta', async () => {
      const responseContent = 'Resposta errada.';
      const corrected = 'Resposta corrigida.';

      const provider = createMockCritiqueProvider({
        default: {
          parsedJson: {
            hasError: true,
            correctedOutput: corrected,
            errors: [{ type: 'hallucination', description: 'Informação incorreta' }],
          },
          rawText: JSON.stringify({
            hasError: true,
            correctedOutput: corrected,
            errors: [{ type: 'hallucination', description: 'Informação incorreta' }],
          }),
        },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.finalContent).toBe(corrected);
      expect(result.correctionStatus).toBe('stable');
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].type).toBe('hallucination');
    });

    it('deve retornar resposta vazia se entrada for vazia', async () => {
      const provider = createMockCritiqueProvider({
        default: { parsedJson: {}, rawText: '{}' },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect('', 'test-model');
      expect(result.finalContent).toBe('');
      expect(result.correctionStatus).toBe('stable');
    });

    it('deve retornar resposta vazia se entrada for só espaços', async () => {
      const provider = createMockCritiqueProvider({
        default: { parsedJson: {}, rawText: '{}' },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect('   ', 'test-model');
      expect(result.finalContent).toBe('');
      expect(result.correctionStatus).toBe('stable');
    });

    it('deve retornar resposta original se JSON do provider for inválido (rejected)', async () => {
      const responseContent = 'Resposta original.';

      // Provider que retorna parsedJson vazio (simula JSON inválido)
      const provider = createMockCritiqueProvider({
        default: { parsedJson: {}, rawText: 'JSON inválido aqui' },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.finalContent).toBe(responseContent);
      expect(result.correctionStatus).toBe('stable');
    });

    it('deve detectar múltiplos erros na resposta', async () => {
      const responseContent = 'Resposta com vários problemas.';
      const corrected = 'Resposta totalmente corrigida.';

      const provider = createMockCritiqueProvider({
        default: {
          parsedJson: {
            hasError: true,
            correctedOutput: corrected,
            errors: [
              { type: 'hallucination', description: 'Erro factual 1' },
              { type: 'logic', description: 'Erro de raciocínio' },
              { type: 'inconsistency', description: 'Informação faltando' },
            ],
          },
          rawText: JSON.stringify({
            hasError: true,
            correctedOutput: corrected,
            errors: [
              { type: 'hallucination', description: 'Erro factual 1' },
              { type: 'logic', description: 'Erro de raciocínio' },
              { type: 'inconsistency', description: 'Informação faltando' },
            ],
          }),
        },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      expect(result.correctionStatus).toBe('stable');
      expect(result.errors).toHaveLength(3);
      expect(result.errors!.map((e) => e.type)).toContain('hallucination');
      expect(result.errors!.map((e) => e.type)).toContain('logic');
      expect(result.errors!.map((e) => e.type)).toContain('inconsistency');
    });

    it('deve incluir toolRegistry no prompt de crítica', async () => {
      const toolRegistry = { getToolNames: () => ['readFile'] };

      const provider = createMockCritiqueProvider({
        default: {
          parsedJson: {
            hasError: false,
            correctedOutput: '',
            errors: [],
          },
          rawText: JSON.stringify({
            hasError: false,
            correctedOutput: '',
            errors: [],
          }),
        },
      });
      const reflector = new Reflector(provider, toolRegistry);

      const result = await reflector.reflect('Resposta correta.', 'test-model');

      expect(result.correctionStatus).toBe('stable');
      expect(result.finalContent).toBe('Resposta correta.');
    });

    it('deve lidar com erro do provider sem quebrar (fallback → rejected)', async () => {
      const provider: ICritiqueProvider = {
        name: 'test-critique-provider',
        critique: vi.fn().mockRejectedValue(new Error('Rede falhou')),
      };
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(
        'Resposta original.',
        'test-model'
      );

      // Fallback: retorna o conteúdo original sem reflexão
      expect(result.finalContent).toBe('Resposta original.');
      expect(result.correctionStatus).toBe('rejected');
    });

    it('deve retornar resposta original se hasError=true mas correctedOutput vazio', async () => {
      const responseContent = 'Resposta com problema.';

      const provider = createMockCritiqueProvider({
        default: {
          parsedJson: {
            hasError: true,
            correctedOutput: '',
            errors: [{ type: 'hallucination', description: 'Erro' }],
          },
          rawText: JSON.stringify({
            hasError: true,
            correctedOutput: '',
            errors: [{ type: 'hallucination', description: 'Erro' }],
          }),
        },
      });
      const reflector = new Reflector(provider, mockToolRegistry);

      const result = await reflector.reflect(responseContent, 'test-model');

      // hasError=true mas correctedOutput vazio → mantém original
      expect(result.finalContent).toBe(responseContent);
      expect(result.correctionStatus).toBe('stable');
    });
  });
});
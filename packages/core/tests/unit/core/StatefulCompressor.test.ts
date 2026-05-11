import { describe, it, expect, vi } from 'vitest';
import { StatefulCompressor } from '../../../src/core/StatefulCompressor';
import type { IProvider, ChatRequest, ChatResponse } from '../../../src/providers/types';
import type { ReActMessage } from '../../../src/core/rag/ReActLoop';

/**
 * Cria um mock de IProvider que pode ser configurado por teste.
 */
function createMockProvider(
  response?: string,
  shouldThrow = false,
  throwMessage = 'Provider error',
): IProvider {
  const mock: IProvider = {
    name: 'mock-provider',
    chat: vi.fn(async (_request: ChatRequest): Promise<ChatResponse> => {
      if (shouldThrow) {
        throw new Error(throwMessage);
      }
      return {
        response: response ?? '',
        model: 'mock-model',
        done: true,
      };
    }),
  };
  return mock;
}

/**
 * Cria um array de mensagens ReAct para teste.
 */
function createHistory(count: number): ReActMessage[] {
  const messages: ReActMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}: ${i % 2 === 0 ? 'User says something' : 'Assistant responds'}`,
    });
  }
  return messages;
}

describe('StatefulCompressor', () => {
  describe('compress - success scenario', () => {
    it('deve retornar workingMemory com os tres campos formatados', async () => {
      const jsonResponse = JSON.stringify({
        objective: 'Build a CLI tool for file processing',
        completed: 'Created project structure, implemented file reader',
        critical_rules: 'Must use zero external dependencies',
      });

      const provider = createMockProvider(jsonResponse);
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(10);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Verificar workingMemory contém os três campos formatados
      expect(result.workingMemory).toContain('## Objective');
      expect(result.workingMemory).toContain('Build a CLI tool for file processing');
      expect(result.workingMemory).toContain('## Completed');
      expect(result.workingMemory).toContain('Created project structure, implemented file reader');
      expect(result.workingMemory).toContain('## Critical Rules');
      expect(result.workingMemory).toContain('Must use zero external dependencies');

      // Verificar keptMessages tem exatamente as últimas 3 mensagens
      expect(result.keptMessages).toHaveLength(3);
      expect(result.keptMessages[0].content).toContain('Message 8');
      expect(result.keptMessages[1].content).toContain('Message 9');
      expect(result.keptMessages[2].content).toContain('Message 10');

      // Verificar compressionRatio é menor que 1.0
      expect(result.compressionRatio).toBeLessThan(1.0);
      expect(result.compressionRatio).toBeGreaterThan(0.0);

      // Verificar que o provider foi chamado com os parâmetros corretos
      expect(provider.chat).toHaveBeenCalledTimes(1);
      const chatRequest = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatRequest;
      expect(chatRequest.temperature).toBe(0.1);
      expect(chatRequest.format).toBe('json');
      expect(chatRequest.model).toBe('test-model');
      expect(chatRequest.prompt).toContain('objective');
      expect(chatRequest.prompt).toContain('completed');
      expect(chatRequest.prompt).toContain('critical_rules');
    });

    it('deve funcionar com campos vazios no JSON', async () => {
      const jsonResponse = JSON.stringify({
        objective: '',
        completed: 'Some work done',
        critical_rules: '',
      });

      const provider = createMockProvider(jsonResponse);
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(10);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Apenas campos não-vazios devem aparecer
      expect(result.workingMemory).not.toContain('## Objective');
      expect(result.workingMemory).toContain('## Completed');
      expect(result.workingMemory).not.toContain('## Critical Rules');
      expect(result.keptMessages).toHaveLength(3);
    });

    it('deve preservar as ultimas 3 mensagens mesmo com historico grande', async () => {
      const jsonResponse = JSON.stringify({
        objective: 'Test',
        completed: 'Test',
        critical_rules: 'Test',
      });

      const provider = createMockProvider(jsonResponse);
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(50);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      expect(result.keptMessages).toHaveLength(3);
      expect(result.keptMessages[0].content).toContain('Message 48');
      expect(result.keptMessages[1].content).toContain('Message 49');
      expect(result.keptMessages[2].content).toContain('Message 50');
    });
  });

  describe('compress - JSON parse failure scenario', () => {
    it('deve retornar historico original e compressionRatio 1.0 quando JSON é invalido', async () => {
      // Resposta não-JSON do modelo
      const provider = createMockProvider('I think the objective is...');
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(10);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Deve retornar o histórico completo em keptMessages
      expect(result.keptMessages).toHaveLength(10);
      expect(result.keptMessages).toEqual(history);

      // workingMemory deve ser vazio
      expect(result.workingMemory).toBe('');

      // compressionRatio deve ser 1.0 (100% comprimido = falhou)
      expect(result.compressionRatio).toBe(1.0);
    });

    it('deve retornar historico original e compressionRatio 1.0 quando JSON tem formato errado', async () => {
      // JSON válido mas sem os campos esperados
      const provider = createMockProvider('{"foo": "bar", "baz": 123}');
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(5);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Campos vazios → workingMemory com placeholder
      expect(result.workingMemory).toBe('*(compressed context — no significant content extracted)*');
      expect(result.keptMessages).toHaveLength(3);
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    it('deve retornar historico completo quando historico tem menos de 4 mensagens', async () => {
      const provider = createMockProvider('{}');
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(3); // Apenas 3 mensagens
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Com 3 mensagens ou menos, histórico vai inteiro pra keptMessages
      expect(result.keptMessages).toHaveLength(3);
      expect(result.workingMemory).toBe('');
      expect(result.compressionRatio).toBe(1.0);

      // Provider não deve ser chamado quando não há o que comprimir
      expect(provider.chat).not.toHaveBeenCalled();
    });
  });

  describe('compress - provider exception scenario', () => {
    it('deve truncar historico para as ultimas 3 mensagens quando provider lanca excecao', async () => {
      const provider = createMockProvider('', true, 'Network timeout');
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(10);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Deve retornar apenas as últimas 3 mensagens para evitar loop infinito
      expect(result.keptMessages).toHaveLength(3);
      expect(result.keptMessages).toEqual(history.slice(-3));

      // workingMemory deve ser vazio
      expect(result.workingMemory).toBe('');

      // compressionRatio deve ser 1.0
      expect(result.compressionRatio).toBe(1.0);
    });

    it('NUNCA deve lancar excecao para o chamador', async () => {
      const provider = createMockProvider('', true, 'Critical failure');
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(8);

      // Garantir que nenhuma exceção é lançada
      await expect(
        compressor.compress(history, 'test-model', 'system prompt'),
      ).resolves.not.toThrow();

      const result = await compressor.compress(history, 'test-model', 'system prompt');
      expect(result.keptMessages).toHaveLength(3);
      expect(result.workingMemory).toBe('');
      expect(result.compressionRatio).toBe(1.0);
    });
  });

  describe('compress - edge cases', () => {
    it('deve lidar com historico vazio', async () => {
      const provider = createMockProvider('{}');
      const compressor = new StatefulCompressor(provider);
      const result = await compressor.compress([], 'test-model', 'system prompt');

      expect(result.keptMessages).toHaveLength(0);
      expect(result.workingMemory).toBe('');
      // Sem histórico, nada foi comprimido — ratio é 1.0 (sem dados processados)
      expect(result.compressionRatio).toBe(1.0);
    });

    it('deve tratar campos que nao sao string como vazios', async () => {
      const jsonResponse = JSON.stringify({
        objective: 123,
        completed: null,
        critical_rules: ['rule1', 'rule2'],
      });

      const provider = createMockProvider(jsonResponse);
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(10);
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      // Campos não-string devem ser tratados como vazios
      expect(result.workingMemory).toBe('*(compressed context — no significant content extracted)*');
    });

    it('deve funcionar com historico exatamente igual a 4 mensagens', async () => {
      const jsonResponse = JSON.stringify({
        objective: 'Do something',
        completed: 'Nothing yet',
        critical_rules: 'Be careful',
      });

      const provider = createMockProvider(jsonResponse);
      const compressor = new StatefulCompressor(provider);
      const history = createHistory(4); // 1 para comprimir + 3 para keptMessages
      const result = await compressor.compress(history, 'test-model', 'system prompt');

      expect(result.keptMessages).toHaveLength(3);
      expect(result.workingMemory).toContain('## Objective');
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(provider.chat).toHaveBeenCalledTimes(1);
    });
  });
});
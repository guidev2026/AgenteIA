import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReActLoop } from '../../../src/core/rag/ReActLoop';
import { CommandExecutor } from '../../../src/core/CommandExecutor';
import type { IProvider } from '../../../src/providers/types';

/**
 * Testes unitários para ReActLoop.
 *
 * Mock das dependências IProvider e CommandExecutor → zero requisições ao Ollama,
 * zero execução de comandos reais.
 * Zero consumo de CPU, zero I/O.
 */

function createMockProvider(responses: string[]): IProvider {
  let callIndex = 0;
  return {
    name: 'MockProvider',
    chat: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex] ?? 'FINAL_ANSWER: concluído';
      callIndex++;
      return { response, model: 'mock', done: true };
    }),
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
}

function createMockExecutor(): CommandExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      stdout: 'saída mock',
      stderr: '',
      exitCode: 0,
      signal: null,
    }),
  } as unknown as CommandExecutor;
}

describe('ReActLoop.execute()', () => {
  let provider: IProvider;
  let executor: CommandExecutor;
  let loop: ReActLoop;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna FINAL_ANSWER na primeira iteração', async () => {
    provider = createMockProvider(['Aqui está a FINAL_ANSWER: 42']);
    executor = createMockExecutor();
    loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'Qual a resposta?' }],
      'phi3:3b'
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER');
    expect(result.iterations).toBe(1);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    // Deve ter passado o model correto
    const callArgs = (provider.chat as any).mock.calls[0][0];
    expect(callArgs.model).toBe('phi3:3b');
  });

  it('executa ACTION e realimenta o prompt até FINAL_ANSWER', async () => {
    // Primeira chamada: ACTION, segunda: FINAL_ANSWER
    provider = createMockProvider([
      'ACTION: ls -la',
      'FINAL_ANSWER: resultado obtido',
    ]);
    executor = createMockExecutor();
    loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'liste os arquivos' }]
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER');
    expect(result.iterations).toBe(2);
    // O executor deve ter sido chamado com 'ls' e ['-la']
    expect(executor.execute).toHaveBeenCalledWith('ls', ['-la'], { timeout: 30000 });
  });

  it('limita iterações a MAX_ITERATIONS sem FINAL_ANSWER', async () => {
    // Provider nunca retorna FINAL_ANSWER — apenas respostas curtas
    provider = createMockProvider(Array(15).fill('continuando...'));
    executor = createMockExecutor();
    loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'teste' }]
    );

    // Deve ter parado após 10 iterações (MAX_ITERATIONS)
    expect(result.iterations).toBe(10);
    // finalAnswer não deve estar vazio (fallback)
    expect(result.finalAnswer.length).toBeGreaterThan(0);
  });

  it('trata erro na execução de ACTION e continua', async () => {
    const mockExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('comando não encontrado')),
    } as unknown as CommandExecutor;

    provider = createMockProvider([
      'ACTION: comando_inexistente',
      'FINAL_ANSWER: lidou com erro',
    ]);
    loop = new ReActLoop(provider, mockExecutor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'execute' }]
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER');
    expect(result.iterations).toBe(2);
  });

  it('constrói o prompt com system prompt e histórico', async () => {
    provider = createMockProvider(['FINAL_ANSWER: pronto']);
    executor = createMockExecutor();
    loop = new ReActLoop(provider, executor);

    await loop.execute(
      'Você é um assistente',
      [
        { role: 'system', content: 'seja breve' },
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'olá' },
      ]
    );

    const promptArg = (provider.chat as any).mock.calls[0][0].prompt;
    expect(promptArg).toContain('[SYSTEM]: seja breve');
    expect(promptArg).toContain('[USER]: oi');
    expect(promptArg).toContain('[ASSISTANT]: olá');
  });

  it('usa tinyllama:1b como modelo padrão quando não especificado', async () => {
    provider = createMockProvider(['FINAL_ANSWER: ok']);
    executor = createMockExecutor();
    loop = new ReActLoop(provider, executor);

    await loop.execute('teste', [{ role: 'user', content: 'teste' }]);

    const callArgs = (provider.chat as any).mock.calls[0][0];
    expect(callArgs.model).toBe('tinyllama:1b');
  });
});
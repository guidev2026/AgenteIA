import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReActLoop } from '../../../src/core/rag/ReActLoop';
import { CommandExecutor } from '../../../src/core/CommandExecutor';
import { ToolRegistry } from '../../../src/core/ToolRegistry';
import type { IProvider } from '../../../src/providers/types';

/**
 * Testes unitários para ReActLoop.
 *
 * Mock das dependências IProvider, CommandExecutor e ToolRegistry →
 * zero requisições ao Ollama, zero execução de comandos reais, zero tool calls reais.
 * Zero consumo de CPU, zero I/O.
 *
 * Cobre ambos os modos:
 * - Text mode (ACTION / FINAL_ANSWER) — legado, com CommandExecutor
 * - JSON mode (tool_call / final_response) — novo, com ToolRegistry
 */

// ── Helpers de mock ──

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

/**
 * Cria um mock de provider com streamChat implementado.
 * Usa um AsyncGenerator que itera sobre os tokens da resposta.
 */
function createMockStreamProvider(responseContent: string): IProvider {
  return {
    name: 'MockStreamProvider',
    chat: vi.fn().mockResolvedValue({ response: responseContent, model: 'mock', done: true }),
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    streamChat: vi.fn().mockImplementation(
      async function* () {
        // Yield character by character para simular streaming real
        for (const char of responseContent) {
          yield char;
        }
      }
    ),
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

function createMockToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    'readFile',
    'Read a file',
    { path: { type: 'string', description: 'file path' } },
    vi.fn().mockResolvedValue('conteúdo mockado do arquivo')
  );
  registry.register(
    'readDir',
    'List directory',
    { path: { type: 'string', description: 'directory path' } },
    vi.fn().mockResolvedValue('dir1\ndir2')
  );
  return registry;
}

// ── Suite de testes ──

describe('ReActLoop.execute() — Text Mode (ACTION/FINAL_ANSWER)', () => {
  let provider: IProvider;
  let executor: CommandExecutor;
  let loop: ReActLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createMockProvider([]);
    executor = createMockExecutor();
    loop = new ReActLoop(provider, executor);
  });

  it('retorna FINAL_ANSWER na primeira iteração', async () => {
    provider = createMockProvider(['Aqui está a FINAL_ANSWER: 42']);
    loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'Qual a resposta?' }],
      'phi3:3b'
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER');
    expect(result.iterations).toBe(1);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    const callArgs = (provider.chat as any).mock.calls[0][0];
    expect(callArgs.model).toBe('phi3:3b');
  });

  it('executa ACTION e realimenta o prompt até FINAL_ANSWER', async () => {
    provider = createMockProvider([
      'ACTION: ls -la',
      'FINAL_ANSWER: resultado obtido',
    ]);
    loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'liste os arquivos' }]
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER');
    expect(result.iterations).toBe(2);
    expect(executor.execute).toHaveBeenCalledWith('ls', ['-la'], { timeout: 30000 });
  });

  it('limita iterações a MAX_ITERATIONS (5) sem FINAL_ANSWER', async () => {
    provider = createMockProvider(Array(10).fill('continuando...'));
    loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'teste' }]
    );

    expect(result.iterations).toBe(5); // MAX_ITERATIONS real
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
    loop = new ReActLoop(provider, executor);

    await loop.execute('teste', [{ role: 'user', content: 'teste' }]);

    const callArgs = (provider.chat as any).mock.calls[0][0];
    expect(callArgs.model).toBe('tinyllama:1b');
  });
});

describe('ReActLoop.execute() — JSON Mode (tool_call/final_response)', () => {
  let provider: IProvider;
  let toolRegistry: ToolRegistry;
  let loop: ReActLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry = createMockToolRegistry();
  });

  it('final_response na primeira iteração retorna imediatamente', async () => {
    provider = createMockProvider([
      '{"final_response": "resposta direta"}',
    ]);
    loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'pergunta' }],
      'phi3:3b',
      { jsonMode: true }
    );

    expect(result.finalAnswer).toBe('resposta direta');
    expect(result.iterations).toBe(1);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    // Deve ter passado format: 'json'
    const callArgs = (provider.chat as any).mock.calls[0][0];
    expect(callArgs.format).toBe('json');
  });

  it('tool_call → executa ferramenta → final_response', async () => {
    provider = createMockProvider([
      '{"tool_call": "readFile", "args": {"path": "test.txt"}}',
      '{"final_response": "arquivo lido com sucesso"}',
    ]);
    loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'Leia o arquivo',
      [{ role: 'user', content: 'leia test.txt' }],
      'phi3:3b',
      { jsonMode: true }
    );

    expect(result.finalAnswer).toBe('arquivo lido com sucesso');
    expect(result.iterations).toBe(2);
    // ToolRegistry deve ter executado readFile
    const executeSpy = (toolRegistry as any).tools.get('readFile').handler;
    expect(executeSpy).toHaveBeenCalledWith({ path: 'test.txt' });
  });

  it('detecta tool_call repetido e força final_response', async () => {
    // Mesma tool_call duas vezes consecutivas → detecta loop
    provider = createMockProvider([
      '{"tool_call": "readFile", "args": {"path": "x.txt"}}',
      '{"tool_call": "readFile", "args": {"path": "x.txt"}}',
      '{"final_response": "final após loop detectado"}',
    ]);
    loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'leia x.txt' }],
      'phi3:3b',
      { jsonMode: true }
    );

    expect(result.finalAnswer).toBe('final após loop detectado');
    expect(result.iterations).toBe(3);
  });

  it('se jsonMode=true mas sem toolRegistry, usa text mode', async () => {
    provider = createMockProvider(['FINAL_ANSWER: fallback']);
    loop = new ReActLoop(provider, createMockExecutor());

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      undefined,
      { jsonMode: true }
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER');
  });

  it('resposta não-JSON em jsonMode retorna cru como fallback', async () => {
    provider = createMockProvider(['texto puro sem JSON']);
    loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      undefined,
      { jsonMode: true }
    );

    expect(result.finalAnswer).toBe('texto puro sem JSON');
    expect(result.iterations).toBe(1);
  });

  it('formato desconhecido (tool_call sem final_response) retorna fallback', async () => {
    provider = createMockProvider(['{"algo": "estranho"}']);
    loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      undefined,
      { jsonMode: true }
    );

    // Fallback retorna o conteúdo cru
    expect(result.finalAnswer).toContain('algo');
    expect(result.iterations).toBe(1);
  });

  it('trata erro na execução da ferramenta e continua', async () => {
    const failingRegistry = new ToolRegistry();
    failingRegistry.register(
      'failingTool',
      'A tool that fails',
      { input: { type: 'string', description: 'input' } },
      vi.fn().mockRejectedValue(new Error('erro interno'))
    );

    provider = createMockProvider([
      '{"tool_call": "failingTool", "args": {"input": "teste"}}',
      '{"final_response": "tratou erro e continuou"}',
    ]);
    loop = new ReActLoop(provider, undefined, failingRegistry);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      undefined,
      { jsonMode: true }
    );

    expect(result.finalAnswer).toBe('tratou erro e continuou');
    expect(result.iterations).toBe(2);
  });

  it('esgota MAX_ITERATIONS sem final_response retorna mensagem de esgotamento', async () => {
    // Sempre retorna tool_call (nunca final_response)
    provider = createMockProvider(Array(10).fill(
      '{"tool_call": "readFile", "args": {"path": "a.txt"}}'
    ));
    loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      undefined,
      { jsonMode: true }
    );

    expect(result.iterations).toBe(5);
    expect(result.finalAnswer).toContain('não conseguiu');
  });
});

describe('ReActLoop.execute() — Com Reflector (self-correction)', () => {
  let provider: IProvider;
  let reflector: any;

  it('text mode + reflect=true + resposta correta → sem correção', async () => {
    provider = createMockProvider(['FINAL_ANSWER: resposta boa']);
    reflector = {
      reflect: vi.fn().mockResolvedValue({
        finalContent: 'resposta boa',
        correctionStatus: 'stable',
        errors: [],
      }),
    };
    const loop = new ReActLoop(provider, createMockExecutor(), undefined, reflector);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { reflect: true }
    );

    expect(result.finalAnswer).toBe('resposta boa');
    expect(result.correctionStatus).toBe('stable');
    expect(reflector.reflect).toHaveBeenCalledTimes(1);
    expect(reflector.reflect).toHaveBeenCalledWith('FINAL_ANSWER: resposta boa', 'phi3:3b');
  });

  it('text mode + reflect=true + resposta incorreta → aplica correção', async () => {
    provider = createMockProvider(['FINAL_ANSWER: resposta errada']);
    reflector = {
      reflect: vi.fn().mockResolvedValue({
        finalContent: 'resposta corrigida',
        correctionStatus: 'stable',
        errors: [{ type: 'hallucination', description: 'informação errada' }],
      }),
    };
    const loop = new ReActLoop(provider, createMockExecutor(), undefined, reflector);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { reflect: true }
    );

    expect(result.finalAnswer).toBe('resposta corrigida');
    expect(result.correctionStatus).toBe('stable');
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].type).toBe('hallucination');
  });

  it('text mode + reflect=false → não chama Reflector mesmo se injetado', async () => {
    provider = createMockProvider(['FINAL_ANSWER: resposta']);
    reflector = {
      reflect: vi.fn().mockResolvedValue({
        finalContent: 'resposta refletida',
        correctionStatus: 'stable',
        errors: [],
      }),
    };
    const loop = new ReActLoop(provider, createMockExecutor(), undefined, reflector);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { reflect: false }
    );

    expect(result.finalAnswer).toBe('FINAL_ANSWER: resposta');
    expect(reflector.reflect).not.toHaveBeenCalled();
  });

  it('JSON mode + reflect=true → reflete após final_response', async () => {
    const toolRegistry = createMockToolRegistry();
    provider = createMockProvider(['{"final_response": "resposta json"}']);
    reflector = {
      reflect: vi.fn().mockResolvedValue({
        finalContent: 'resposta json',
        correctionStatus: 'stable',
        errors: [],
      }),
    };
    const loop = new ReActLoop(provider, undefined, toolRegistry, reflector);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { jsonMode: true, reflect: true }
    );

    expect(result.finalAnswer).toBe('resposta json');
    expect(result.correctionStatus).toBe('stable');
    expect(reflector.reflect).toHaveBeenCalledWith('resposta json', 'phi3:3b');
  });

  it('JSON mode + reflect=true + correção → aplica', async () => {
    const toolRegistry = createMockToolRegistry();
    provider = createMockProvider(['{"final_response": "resposta errada"}']);
    reflector = {
      reflect: vi.fn().mockResolvedValue({
        finalContent: 'resposta corrigida pelo refletor',
        correctionStatus: 'stable',
        errors: [{ type: 'logic', description: 'contradição' }],
      }),
    };
    const loop = new ReActLoop(provider, undefined, toolRegistry, reflector);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { jsonMode: true, reflect: true }
    );

    expect(result.finalAnswer).toBe('resposta corrigida pelo refletor');
    expect(result.correctionStatus).toBe('stable');
    expect(result.errors![0].type).toBe('logic');
  });

  it('reflect=true mas reflector não injetado → não quebra', async () => {
    provider = createMockProvider(['FINAL_ANSWER: resposta']);
    // Sem Reflector (undefined)
    const loop = new ReActLoop(provider, createMockExecutor());

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { reflect: true }
    );

    expect(result.finalAnswer).toBe('FINAL_ANSWER: resposta');
    expect(result.correctionStatus).toBeUndefined();
  });

  it('streamMode + streamChat disponível → faz streaming dos tokens (jsonMode)', async () => {
    const tokens: string[] = [];
    provider = createMockStreamProvider('{"final_response": "resposta com stream"}');
    const toolRegistry = createMockToolRegistry();
    const loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'pergunta' }],
      'phi3:3b',
      {
        jsonMode: true,
        stream: {
          enabled: true,
          onToken: (token: string) => { tokens.push(token); },
        },
      }
    );

    expect(result.finalAnswer).toBe('resposta com stream');
    expect(result.iterations).toBe(1);
    // Deve ter recebido tokens via callback (streamChat foi usado)
    expect(tokens.join('')).toBe('{"final_response": "resposta com stream"}');
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
  });

  it('streamMode + streamChat disponível → faz streaming na última iteração (textMode)', async () => {
    const tokens: string[] = [];
    provider = createMockStreamProvider('FINAL_ANSWER: resultado streaming');
    const executor = createMockExecutor();
    const loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'pergunta' }],
      'phi3:3b',
      {
        stream: {
          enabled: true,
          onToken: (token: string) => { tokens.push(token); },
        },
      }
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER: resultado streaming');
    expect(tokens.join('')).toContain('FINAL_ANSWER: resultado streaming');
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
  });

  it('streamMode=true mas provider sem streamChat → usa chat() normal sem stream', async () => {
    provider = {
      name: 'NoStreamProvider',
      chat: vi.fn().mockResolvedValue({ response: 'FINAL_ANSWER: sem stream', model: 'mock', done: true }),
      embed: vi.fn().mockResolvedValue([0.1]),
      // Sem streamChat — proposital
    };
    const executor = createMockExecutor();
    const loop = new ReActLoop(provider, executor);

    let onTokenCalled = false;
    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      {
        stream: {
          enabled: true,
          onToken: () => { onTokenCalled = true; },
        },
      }
    );

    expect(result.finalAnswer).toContain('sem stream');
    expect(result.iterations).toBe(1);
    // onToken nunca deve ser chamado porque streamChat não existe
    expect(onTokenCalled).toBe(false);
  });

  it('streamMode=false → não usa streaming mesmo com streamChat disponível', async () => {
    provider = createMockStreamProvider('FINAL_ANSWER: sem streaming');
    const executor = createMockExecutor();
    const loop = new ReActLoop(provider, executor);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { stream: undefined }
    );

    expect(result.finalAnswer).toContain('FINAL_ANSWER: sem streaming');
    // streamChat não deve ser chamado porque stream está undefined
    expect(provider.streamChat).not.toHaveBeenCalled();
  });

  it('streamMode + streamChat + MÚLTIPLAS iterações → resolve corretamente com streaming', async () => {
    const tokens: string[] = [];
    // Provider com streamChat: a primeira chamada retorna tool_call, a segunda final_response
    // O sendPrompt sempre prefere streamChat sobre chat quando streamOpts está ativo,
    // então o streamMock precisa ser configurado para múltiplas chamadas.
    let streamCallCount = 0;
    const streamMock = vi.fn().mockImplementation(
      async function* () {
        streamCallCount++;
        if (streamCallCount === 1) {
          yield '{"tool_call": "readFile", "args": {"path": "test.txt"}}';
        } else {
          yield '{"final_response": "stream final"}';
        }
      }
    );

    provider = {
      name: 'MultiIterationStreamProvider',
      chat: vi.fn().mockResolvedValue({ response: 'fallback', model: 'mock', done: true }),
      streamChat: streamMock,
      embed: vi.fn().mockResolvedValue([0.1]),
    };
    const toolRegistry = createMockToolRegistry();
    const loop = new ReActLoop(provider, undefined, toolRegistry);

    const result = await loop.execute(
      'Seja útil',
      [{ role: 'user', content: 'pergunta' }],
      'phi3:3b',
      {
        jsonMode: true,
        stream: {
          enabled: true,
          onToken: (token: string) => { tokens.push(token); },
        },
      }
    );

    expect(result.finalAnswer).toBe('stream final');
    expect(result.iterations).toBe(2);
    // streamChat foi chamado duas vezes (tool_call + final_response)
    expect(streamMock).toHaveBeenCalledTimes(2);
    // Tokens da última iteração (final_response)
    expect(tokens.join('')).toContain('stream final');
  });

  it('reflect=true mas resposta vazia → Reflector é chamado (validação vazia dentro dele)', async () => {
    provider = createMockProvider(['']);
    reflector = {
      reflect: vi.fn().mockResolvedValue({
        finalContent: '',
        correctionStatus: 'stable',
        errors: [],
      }),
    };
    const loop = new ReActLoop(provider, createMockExecutor(), undefined, reflector);

    const result = await loop.execute(
      'teste',
      [{ role: 'user', content: 'teste' }],
      'phi3:3b',
      { reflect: true }
    );

    expect(reflector.reflect).toHaveBeenCalled();
  });
});

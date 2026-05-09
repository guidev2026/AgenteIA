import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../../../src/providers/OllamaProvider';
import type { ChatRequest } from '../../../src/providers/types';

/**
 * Testes unitários para OllamaProvider.
 *
 * Mock do módulo nativo `node:http` → zero requisições reais.
 * Zero consumo de CPU por Ollama, zero I/O de rede.
 * Compatível com hardware de 12GB — sem carregar modelos.
 */

// Mock completo do node:http
const mockResponses: Map<string, { status: number; data: string }> = new Map();
let lastRequestBody: string = '';

vi.mock('node:http', () => {
  // Função que simula http.request
  const request = (
    options: any,
    callback?: (res: any) => void
  ): any => {
    // Encontra a resposta mockada baseada no path
    const path = options.path || '/api/generate';
    const mock = mockResponses.get(path) || { status: 200, data: '{}' };

    // Simula IncomingMessage — emite dados como string (não Buffer)
    const res: any = {
      statusCode: mock.status,
      closed: false,
      destroyed: false,
      on: (event: string, handler: any) => {
        if (event === 'data') {
          setTimeout(() => handler(mock.data), 0);
        }
        if (event === 'end' || event === 'close') {
          setTimeout(() => handler(), 0);
        }
        return res;
      },
      // Iterator assíncrono para for await...of (postStream)
      [Symbol.asyncIterator]: () => {
        let emitted = false;
        return {
          next: () => {
            if (emitted) return Promise.resolve({ value: undefined, done: true });
            emitted = true;
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve({ value: mock.data, done: false });
              }, 0);
            });
          },
        };
      },
    };

    // Se callback foi passado (modo post tradicional), chama direto
    if (callback) {
      setTimeout(() => callback(res), 0);
    }

    // Objeto req com suporte a req.on('response') usado pelo postStream
    const req: any = {
      on: (_event: string, handler: any) => {
        // postStream usa req.on('response') em vez de callback
        if (_event === 'response' && !callback) {
          setTimeout(() => handler(res), 0);
        }
        return req;
      },
      setTimeout: (_ms: number, _handler: any) => {},
      write: (body: string) => { lastRequestBody = body; },
      end: () => {},
      destroy: () => {},
    };

    return req;
  };

  return { default: { request }, request };
});

describe('OllamaProvider.chat()', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockResponses.clear();
    lastRequestBody = '';
    provider = new OllamaProvider('localhost', 11434);
  });

  it('faz requisição POST para /api/generate com os parâmetros corretos', async () => {
    mockResponses.set('/api/generate', {
      status: 200,
      data: JSON.stringify({ response: 'Olá!', model: 'phi3:3b', done: true }),
    });

    const request: ChatRequest = {
      model: 'phi3:3b',
      prompt: 'Diga olá',
      temperature: 0.5,
      max_tokens: 100,
    };

    const result = await provider.chat(request);

    // Verifica se a requisição foi montada corretamente
    expect(lastRequestBody).toContain('"model":"phi3:3b"');
    expect(lastRequestBody).toContain('"prompt":"Diga olá"');
    expect(lastRequestBody).toContain('"temperature":0.5');
    expect(lastRequestBody).toContain('"num_predict":100');

    // Verifica a resposta
    expect(result.response).toBe('Olá!');
    expect(result.model).toBe('phi3:3b');
    expect(result.done).toBe(true);
  });

  it('ativa format=json quando request.format é json', async () => {
    mockResponses.set('/api/generate', {
      status: 200,
      data: JSON.stringify({ response: '{"chave":"valor"}', model: 'phi3', done: true }),
    });

    await provider.chat({ model: 'phi3', prompt: 'JSON', format: 'json' });

    expect(lastRequestBody).toContain('"format":"json"');
  });

  it('valida que resposta é JSON quando format=json (JSON inválido → erro)', async () => {
    mockResponses.set('/api/generate', {
      status: 200,
      data: JSON.stringify({ response: 'não é json', model: 'phi3', done: true }),
    });

    await expect(
      provider.chat({ model: 'phi3', prompt: 'fail', format: 'json' })
    ).rejects.toThrow(/invalid JSON/);
  });

  it('propaga erro HTTP do servidor', async () => {
    mockResponses.set('/api/generate', {
      status: 500,
      data: 'Internal Server Error',
    });

    await expect(
      provider.chat({ model: 'phi3', prompt: 'test' })
    ).rejects.toThrow(/Ollama error 500/);
  });

  it('usa temperature padrão 0.7 quando não especificada', async () => {
    mockResponses.set('/api/generate', {
      status: 200,
      data: JSON.stringify({ response: 'ok', model: 'phi3', done: true }),
    });

    await provider.chat({ model: 'phi3', prompt: 'test' });

    expect(lastRequestBody).toContain('"temperature":0.7');
  });
});

describe('OllamaProvider.streamChat()', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockResponses.clear();
    lastRequestBody = '';
    provider = new OllamaProvider();
  });

  it('emite tokens individualmente conforme chegam do servidor', async () => {
    const tokens: string[] = [];
    mockResponses.set('/api/generate', {
      status: 200,
      data: [
        JSON.stringify({ response: 'Olá', done: false }),
        '\n',
        JSON.stringify({ response: ' Mundo', done: false }),
        '\n',
        JSON.stringify({ response: '!', done: true }),
        '\n',
      ].join(''),
    });

    for await (const token of provider.streamChat({
      model: 'phi3:3b',
      prompt: 'Teste streaming',
    })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Olá', ' Mundo', '!']);
  });

  it('monta body com stream:true', async () => {
    mockResponses.set('/api/generate', {
      status: 200,
      data: JSON.stringify({ response: 'ok', done: true }) + '\n',
    });

    for await (const _ of provider.streamChat({
      model: 'phi3:3b',
      prompt: 'test',
    })) {
      // Consome o generator
    }

    const body = JSON.parse(lastRequestBody);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('phi3:3b');
    expect(body.prompt).toBe('test');
  });

  it('lança erro no streaming se servidor retorna status não-200', async () => {
    mockResponses.set('/api/generate', {
      status: 500,
      data: 'Server Error',
    });

    const iterator = provider.streamChat({
      model: 'phi3:3b',
      prompt: 'test',
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow(/Ollama error 500/);
  });

  it('pula linhas vazias ou não-JSON no stream', async () => {
    const tokens: string[] = [];
    mockResponses.set('/api/generate', {
      status: 200,
      data: [
        '',                       // vazia (ignora)
        '\n',                     // linha em branco
        JSON.stringify({ response: 'Token1', done: false }),
        '\n',
        'not json line\n',        // não-JSON (ignora)
        JSON.stringify({ response: 'Token2', done: true }),
        '\n',
      ].join(''),
    });

    for await (const token of provider.streamChat({
      model: 'phi3:3b',
      prompt: 'test',
    })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Token1', 'Token2']);
  });

  it('trata chunks TCP quebrados (parcialmente recebidos)', async () => {
    const tokens: string[] = [];
    mockResponses.set('/api/generate', {
      status: 200,
      data: [
        '{"response":"Hel',
        'lo","done":false}\n',
        '{"response":" World","done":true}\n',
      ].join(''),
    });

    for await (const token of provider.streamChat({
      model: 'phi3:3b',
      prompt: 'test',
    })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Hello', ' World']);
  });
});

describe('OllamaProvider.embed()', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockResponses.clear();
    lastRequestBody = '';
    provider = new OllamaProvider();
  });

  it('faz requisição POST para /api/embed e retorna o embedding', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
    mockResponses.set('/api/embed', {
      status: 200,
      data: JSON.stringify({ embeddings: [mockEmbedding] }),
    });

    const result = await provider.embed('texto para embedar', 'all-minilm', '0s');

    expect(lastRequestBody).toContain('"model":"all-minilm"');
    expect(lastRequestBody).toContain('"input":"texto para embedar"');
    expect(lastRequestBody).toContain('"keep_alive":"0s"');
    expect(result).toEqual(mockEmbedding);
  });

  it('lança erro quando resposta não tem embeddings', async () => {
    mockResponses.set('/api/embed', {
      status: 200,
      data: JSON.stringify({ embeddings: [] }),
    });

    await expect(provider.embed('teste')).rejects.toThrow(/no embeddings/);
  });
});
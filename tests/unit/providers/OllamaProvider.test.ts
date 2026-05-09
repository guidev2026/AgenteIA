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

    // Simula IncomingMessage
    const res = {
      statusCode: mock.status,
      on: (event: string, handler: any) => {
        if (event === 'data') {
          // Emite os dados como Buffer (simula resposta HTTP real)
          setImmediate(() => handler(Buffer.from(mock.data)));
        }
        if (event === 'end') {
          setImmediate(() => handler());
        }
        return res;
      },
    };

    if (callback) setImmediate(() => callback(res));

    return {
      on: (_event: string, _handler: any) => {},
      setTimeout: (_ms: number, _handler: any) => {},
      write: (body: string) => { lastRequestBody = body; },
      end: () => {},
      destroy: () => {},
    };
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
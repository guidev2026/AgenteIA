import type {
  ChatRequest,
  ChatResponse,
  CritiqueRequest,
  CritiqueResponse,
  EmbedResponse,
  ICritiqueProvider,
  IProvider,
} from './types';
import { OllamaHttpClient } from './OllamaHttpClient';

/**
 * OllamaProvider: Implementação concreta do IProvider que se comunica
 * com uma instância local do Ollama via HTTP.
 *
 * Fluxo de dados completo (chat):
 * ┌──────────┐    ChatRequest     ┌──────────────────┐   JSON body    ┌─────────────────┐
 * │  CLI     │ ── {model,        │  OllamaProvider   │ ── POST ──▶  │  Ollama Server  │
 * │ (usuário)│    prompt, temp}──▶│  .chat()          │              │  localhost:11434 │
 * └──────────┘                   │  └─ post()        │ ◀── JSON ──  │  /api/generate   │
 *                                │     └─ http.request│              └─────────────────┘
 *                                └──────────────────┘
 *                                       │
 *                                  ChatResponse
 *                                  {response, model, done}
 *                                       │
 *                                       ▼
 *                                  ┌──────────┐
 *                                  │  console │
 *                                  └──────────┘
 *
 * A classe usa exclusivamente o módulo nativo `node:http` (zero dependências externas).
 * O método `chat()` é a interface pública; `post()` é o método privado que gerencia
 * a conexão TCP, timeout e parsing da resposta.
 */
export class OllamaProvider implements IProvider, ICritiqueProvider {
  readonly name = 'Ollama';

  /** Host onde o Ollama está rodando (padrão: localhost) */
  private readonly host: string;
  /** Porta da API do Ollama (padrão: 11434) */
  private readonly port: number;

  /**
   * @param host Endereço do servidor Ollama
   * @param port Porta do servidor Ollama
   */
  constructor(
    host: string = 'localhost',
    port: number = 11434,
    private readonly http: OllamaHttpClient = new OllamaHttpClient(host, port)
  ) {
    this.host = host;
    this.port = port;
  }

  /**
   * Envia um prompt ao Ollama e retorna a resposta gerada pelo modelo.
   *
   * Pipeline:
   *   1. Constrói o JSON body conforme a API do Ollama:
   *      - model: identificador do modelo (ex: "phi3:3b", "tinyllama:1b")
   *      - prompt: texto do usuário
   *      - stream: false → resposta única, sem streaming SSE
   *      - options.temperature: criatividade (0 = determinístico, 1 = criativo)
   *      - options.num_predict: limite de tokens na resposta
   *   2. Chama this.post('/api/generate', body) → requisição HTTP POST
   *   3. Extrai data.response, data.model, data.done da resposta JSON
   *   4. Retorna ChatResponse padronizado
   *
   * @param request Dados da requisição (modelo, prompt, parâmetros)
   * @returns Resposta do modelo encapsulada em ChatResponse
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Monta o objeto do body de forma incremental para suportar format opcional
    const bodyObj: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      stream: false,
      options: {
        // temperature: controla aleatoriedade (0-1). Padrão 0.7 se não informado.
        temperature: request.temperature ?? 0.7,
        // num_predict: máximo de tokens a gerar. undefined = sem limite.
        num_predict: request.max_tokens,
      },
    };

    // Quando format='json', ativa o Grammar Restraint nativo do Ollama
    // A API /api/generate aceita "format": "json" para forçar resposta em JSON
    if (request.format === 'json') {
      bodyObj.format = 'json';
    }

    const body = JSON.stringify(bodyObj);
    const data = await this.http.post('/api/generate', body);

    // Validação de robustez: se o contrato exigia JSON, verifica se a resposta
    // do modelo é realmente parseável. Isso previne que alucinações ou falhas
    // do modelo cheguem ao CLI como dados inválidos.
    if (request.format === 'json') {
      try {
        JSON.parse(data.response);
      } catch {
        throw new Error(
          `Model returned invalid JSON despite format=json flag. ` +
          `Raw response (first 200 chars): ${data.response.slice(0, 200)}`
        );
      }
    }

    return {
      response: data.response,
      model: data.model,
      done: data.done,
    };
  }

  /**
   * streamChat: Envia um prompt ao Ollama com streaming habilitado e
   * retorna um AsyncIterable que emite cada token individualmente.
   *
   * Pipeline:
   *   1. Constrói o JSON body com stream: true (SSE habilitado)
   *   2. Chama this.postStream('/api/generate', body) → AsyncGenerator
   *   3. Cada token é emitido via yield conforme chega do servidor
   *
   * O cliente (CLI) pode iterar com `for await...of` e escrever os tokens
   * no stdout em tempo real, criando o efeito "máquina de escrever".
   *
   * @param request Dados da requisição (modelo, prompt, parâmetros)
   * @returns AsyncIterable que emite strings (tokens individuais)
   */
  async *streamChat(request: ChatRequest): AsyncIterable<string> {
    const bodyObj: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.max_tokens,
      },
    };

    if (request.format === 'json') {
      bodyObj.format = 'json';
    }

    const body = JSON.stringify(bodyObj);

    // Delega para o gerador de streaming que lida com a resposta HTTP
    yield* this.http.postStream('/api/generate', body);
  }

  /**
   * Gera um embedding (vetor de floats) para um texto usando o modelo all-minilm.
   *
   * Pipeline:
   *   1. Envia POST /api/embed com { model, input, keep_alive }
   *   2. Extrai embeddings[0] do response
   *   3. Retorna o vetor de números
   *
   * O parâmetro keep_alive controla quanto tempo o modelo fica carregado na RAM:
   *   - "0s": descarrega imediatamente (economiza RAM)
   *   - "30s": mantém carregado por 30s (útil para indexação em lote)
   *   - "-1": mantém indefinidamente (não recomendado com 12GB RAM)
   *
   * @param text  O texto a ser embedado
   * @param embedModel  Nome do modelo de embedding (padrão: all-minilm)
   * @param keepAlive  Tempo de vida do modelo na RAM (padrão: "30s")
   * @returns Vetor de floats representando o embedding
   */
  async embed(
    text: string,
    embedModel: string = 'all-minilm',
    keepAlive: string = '30s'
  ): Promise<number[]> {
    const body = JSON.stringify({
      model: embedModel,
      input: text,
      keep_alive: keepAlive,
    });
    const data: EmbedResponse = await this.http.post('/api/embed', body);
    if (!data.embeddings || data.embeddings.length === 0) {
      throw new Error('Embedding response returned no embeddings');
    }
    return data.embeddings[0];
  }

  /**
   * critique: Submete um prompt de crítica ao modelo com formatação JSON.
   *
   * Diferenças do chat() normal:
   * - stream: false (sempre resposta completa, não streaming)
   * - format: 'json' (força o Ollama a retornar JSON válido)
   * - temperature: 0.1 (baixa para ser mais determinístico)
   * - num_predict: 1024 (limita tokens da crítica)
   *
   * @param request Prompt de crítica + resposta a analisar
   * @returns CritiqueResponse com JSON parseado e rawText
   */
  async critique(request: CritiqueRequest): Promise<CritiqueResponse> {
    const body = JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      stream: false,
      temperature: request.temperature ?? 0.1,
      format: 'json',
      num_predict: 1024,
      options: { num_ctx: 4096 },
    });

    const result = await this.http.post('/api/generate', body) as Record<string, unknown>;
    const rawText = String(result.response ?? '');

    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(rawText.trim());
    } catch {
      // Fallback seguro: se o modelo não retornar JSON válido, devolve vazio
      parsedJson = {};
    }

    return { parsedJson, rawText };
  }

  // post() e postStream() foram extraídos para OllamaHttpClient (SRP)
  // Veja src/providers/OllamaHttpClient.ts
}

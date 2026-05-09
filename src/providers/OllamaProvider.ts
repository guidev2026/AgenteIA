import * as http from 'node:http';
import type { ChatRequest, ChatResponse, IProvider } from './types';

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
export class OllamaProvider implements IProvider {
  readonly name = 'Ollama';

  /** Host onde o Ollama está rodando (padrão: localhost) */
  private readonly host: string;
  /** Porta da API do Ollama (padrão: 11434) */
  private readonly port: number;

  /**
   * @param host Endereço do servidor Ollama
   * @param port Porta do servidor Ollama
   */
  constructor(host: string = 'localhost', port: number = 11434) {
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
    const data = await this.post('/api/generate', body);

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
   * Método interno que realiza a requisição HTTP POST de baixo nível.
   *
   * Fluxo detalhado da requisição:
   *   1. Cria http.RequestOptions com hostname, port, path, method e headers
   *   2. http.request() cria uma conexão TCP com o servidor
   *   3. Callback recebe o objeto http.IncomingMessage (res)
   *   4. Concatena chunks de Buffer conforma chegam (res.on('data'))
   *   5. No evento 'end', verifica statusCode:
   *      - 200 → faz JSON.parse(chunks) e resolve a Promise
   *      - outro → rejeita com mensagem de erro
   *   6. Tratamento de erros:
   *      - 'error': conexão recusada, DNS falhou, etc.
   *      - timeout: 300 segundos (5 min) para modelos grandes
   *   7. req.write(body) envia o corpo JSON
   *   8. req.end() finaliza a requisição
   *
   * Todo o fluxo é encapsulado em uma Promise para uso com async/await.
   *
   * @param path  Caminho da API (ex: '/api/generate')
   * @param body  Corpo JSON já stringificado
   * @returns Promise que resolve com o objeto JSON parseado
   */
  private post(path: string, body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: this.host,
        port: this.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Content-Length é necessário para HTTP/1.1 sem chunked encoding
          'Content-Length': Buffer.byteLength(body),
        },
      };

      // Cria a requisição HTTP — a conexão TCP é estabelecida aqui
      const req = http.request(options, (res) => {
        let chunks = '';
        // Acumula os pedaços do corpo da resposta conforme chegam
        res.on('data', (chunk: Buffer) => {
          chunks += chunk.toString();
        });
        // Resposta completa — todos os chunks recebidos
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(`Ollama error ${res.statusCode}: ${chunks}`)
            );
            return;
          }
          try {
            resolve(JSON.parse(chunks));
          } catch {
            reject(new Error(`Failed to parse Ollama response: ${chunks}`));
          }
        });
      });

      // Erro de rede: servidor offline, DNS, conexão recusada
      req.on('error', (err) => {
        reject(new Error(`Ollama connection failed: ${err.message}`));
      });

      // Timeout de 300 segundos (5 minutos) — modelos pequenos respondem
      // em segundos, mas é seguro ter margem para modelos maiores
      req.setTimeout(300_000, () => {
        req.destroy();
        reject(new Error('Ollama request timed out (300s)'));
      });

      // Envia o corpo JSON e finaliza a requisição
      req.write(body);
      req.end();
    });
  }
}
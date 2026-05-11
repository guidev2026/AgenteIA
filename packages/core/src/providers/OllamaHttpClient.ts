import * as http from 'node:http';

/**
 * OllamaHttpClient: Cliente HTTP de baixo nível para comunicação com a API Ollama.
 *
 * Responsabilidade única (SRP):
 * - Gerenciar conexões TCP, timeouts e parsing de respostas HTTP
 * - Post comum (post) — retorna Promise do JSON parseado
 * - Post com streaming (postStream) — retorna AsyncGenerator de tokens
 *
 * Zero dependências externas — usa exclusivamente node:http.
 */
export class OllamaHttpClient {
  constructor(
    private readonly host: string,
    private readonly port: number
  ) {}

  /**
   * Realiza uma requisição HTTP POST e retorna o corpo parseado como JSON.
   *
   * @param path  Caminho da API (ex: '/api/generate')
   * @param body  Corpo JSON já stringificado
   * @returns Promise que resolve com o objeto JSON parseado
   */
  post(path: string, body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: this.host,
        port: this.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = http.request(options, (res) => {
        let chunks = '';
        res.on('data', (chunk: Buffer) => {
          chunks += chunk.toString();
        });
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

      req.on('error', (err) => {
        reject(new Error(`Ollama connection failed: ${err.message}`));
      });

      req.setTimeout(300_000, () => {
        req.destroy();
        reject(new Error('Ollama request timed out (300s)'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Realiza uma requisição HTTP POST com streaming habilitado e
   * retorna um AsyncGenerator que emite tokens linha por linha.
   *
   * Fluxo:
   * - Conecta via http.request
   * - Aguarda req.on('response') em vez de callback (para suportar async generator)
   * - Processa chunks TCP linha a linha com buffer de linha parcial
   * - Cada linha completa é parseada como JSON e extrai o campo "response"
   * - O loop termina ao receber um objeto com "done": true
   *
   * @param path  Caminho da API (ex: '/api/generate')
   * @param body  Corpo JSON já stringificado (com stream: true)
   * @returns AsyncGenerator que emite strings (tokens individuais)
   */
  async *postStream(path: string, body: string): AsyncGenerator<string> {
    const options: http.RequestOptions = {
      hostname: this.host,
      port: this.port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options);

    // Promise que resolve quando a resposta HTTP começa a chegar
    const responsePromise = new Promise<http.IncomingMessage>((resolve, reject) => {
      req.on('response', (res) => resolve(res));
      req.on('error', (err) => reject(new Error(`Ollama connection failed: ${err.message}`)));
      req.setTimeout(300_000, () => {
        req.destroy();
        reject(new Error('Ollama request timed out (300s)'));
      });
    });

    // Envia o corpo e finaliza a requisição
    req.write(body);
    req.end();

    // Aguarda a resposta HTTP
    const res = await responsePromise;

    // Verifica status code antes de processar streaming
    if (res.statusCode !== 200) {
      const errorBody = await new Promise<string>((resolve) => {
        let chunks = '';
        res.on('data', (chunk: Buffer) => { chunks += chunk.toString(); });
        res.on('end', () => resolve(chunks));
      });
      throw new Error(`Ollama error ${res.statusCode}: ${errorBody}`);
    }

    // Buffer que acumula dados até encontrar uma quebra de linha
    let lineBuffer = '';

    // Processa os chunks TCP conforme chegam
    for await (const chunk of res) {
      const str: string = (chunk as Buffer).toString();
      lineBuffer += str;

      // Processa todas as linhas completas no buffer
      let newlineIndex: number;
      while ((newlineIndex = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);

        // Linha vazia (ex: keep-alive ou separador SSE) → ignora
        if (!line) continue;

        // Tenta parsear cada linha como JSON individual
        try {
          const parsed = JSON.parse(line);
          // Extrai o token de resposta
          if (typeof parsed.response === 'string') {
            yield parsed.response;
          }
          // Se done === true, encerra o streaming
          if (parsed.done === true) {
            return;
          }
        } catch {
          // Linha não-JSON (ex: espaços, comentários SSE) → ignora
          continue;
        }
      }
    }
  }
}
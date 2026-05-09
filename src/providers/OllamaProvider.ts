import * as http from 'node:http';
import type { ChatRequest, ChatResponse, IProvider } from './types';

export class OllamaProvider implements IProvider {
  readonly name = 'Ollama';

  private readonly host: string;
  private readonly port: number;

  constructor(host: string = 'localhost', port: number = 11434) {
    this.host = host;
    this.port = port;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.max_tokens,
      },
    });

    const data = await this.post('/api/generate', body);
    return {
      response: data.response,
      model: data.model,
      done: data.done,
    };
  }

  private post(path: string, body: string): Promise<any> {
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
}
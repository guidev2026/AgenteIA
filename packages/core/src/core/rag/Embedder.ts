/**
 * Embedder: Camada de abstração sobre o provider de embeddings (SRP).
 *
 * Responsabilidade Única:
 * - Recebe um IEmbedProvider e gerencia a chamada de embedding
 * - Controla keep_alive para gerenciamento de RAM
 * - Trata erros de rede/timeout silenciosamente
 *
 * Não faz chunking, não busca no índice, não formata contexto.
 * Apenas embeddings.
 */

import type { IEmbedProvider } from '../../providers/types';

export class Embedder {
  private provider: IEmbedProvider;
  private readonly defaultModel: string;

  constructor(provider: IEmbedProvider, defaultModel: string = 'all-minilm') {
    this.provider = provider;
    this.defaultModel = defaultModel;
  }

  /**
   * Gera embedding para um texto.
   *
   * @param text Texto a ser embedado
   * @param model Nome do modelo (usa default se omitido)
   * @param keepAlive Tempo de keep_alive (padrão "30s" para indexação)
   * @returns Vetor de floats 384-dim
   */
  async embed(text: string, model?: string, keepAlive: string = '30s'): Promise<number[]> {
    return this.provider.embed(text, model ?? this.defaultModel, keepAlive);
  }

  /**
   * Descarrega o modelo de embedding da RAM.
   * Usado após indexação para liberar recursos (12GB RAM limitada).
   */
  async unload(): Promise<void> {
    try {
      await this.provider.embed('', this.defaultModel, '0s');
    } catch {
      // Não falha se o descarregamento não funcionar
    }
  }
}
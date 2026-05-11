/**
 * ProviderFactory: Fábrica de provedores de linguagem (OCP).
 *
 * Open/Closed Principle: Esta classe está ABERTA para extensão
 * (novos provedores podem ser adicionados sem modificar código existente)
 * e FECHADA para modificação (a lógica de seleção é genérica).
 *
 * Para adicionar um novo provider:
 * 1. Crie a classe que implementa IProvider (ex: OpenRouterProvider)
 * 2. Adicione o case no switch ou no map
 * 3. Pronto — nenhuma outra parte do sistema precisa mudar
 */

import type { IProvider, IEmbedProvider } from '../providers/types';
import { OllamaProvider } from '../providers/OllamaProvider';

export type ProviderType = 'ollama';

export interface ProviderConfig {
  type: ProviderType;
  host?: string;
  port?: number;
}

export class ProviderFactory {
  /**
   * Cria um provider baseado na configuração.
   *
   * @param config Configuração do provider (tipo, host, porta)
   * @returns Instância de IProvider
   */
  static createProvider(config: ProviderConfig): IProvider {
    switch (config.type) {
      case 'ollama':
        return new OllamaProvider(config.host, config.port);
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  /**
   * Cria um provider que também suporta embeddings (IEmbedProvider).
   * Útil para garantia em tempo de compilação de que o provider
   * implementa o método embed().
   */
  static createEmbedProvider(config: ProviderConfig): IEmbedProvider {
    const provider = this.createProvider(config);
    if (!('embed' in provider)) {
      throw new Error(
        `Provider "${config.type}" does not support embeddings. ` +
        `Use a provider that implements IEmbedProvider.`
      );
    }
    return provider as IEmbedProvider;
  }
}
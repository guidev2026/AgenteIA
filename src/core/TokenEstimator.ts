/**
 * TokenEstimator — Estimador de tokens nativo e sem dependências.
 *
 * Heurística: Math.ceil(text.length / 4) ≈ 4 caracteres por token (média
 * conservadora para modelos Flash como Llama 3.2 e Phi-3).
 *
 * SRP: Responsabilidade única de estimar consumo de tokens.
 * Zero dependências externas.
 */

import type { ReActMessage } from './rag/ReActLoop';

/**
 * Constante com os limites de contexto conhecidos dos modelos suportados.
 * Chave = nome do modelo (tag), Valor = limite máximo de tokens.
 */
export const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  'llama3.2:1b': 4096,
  'phi3:3b': 4096,
  'llama3.2:3b': 4096,
  'mistral:7b': 8192,
};

/**
 * Limite conservador usado como fallback quando o modelo não está mapeado.
 */
const FALLBACK_LIMIT = 4096;

export class TokenEstimator {
  /**
   * Estima o número de tokens em um texto usando a heurística Math.ceil(text.length / 4).
   *
   * @param text  Texto de entrada (pode ser vazio).
   * @returns     Número estimado de tokens (0 para string vazia).
   */
  static estimate(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Estima o total de tokens de um array de mensagens ReAct.
   * Soma `estimate(role + content)` para cada mensagem.
   *
   * @param messages  Array de mensagens no formato ReAct.
   * @returns         Soma total estimada de tokens.
   */
  static estimateMessages(messages: ReActMessage[]): number {
    return messages.reduce(
      (sum, msg) => sum + TokenEstimator.estimate(msg.role + msg.content),
      0,
    );
  }

  /**
   * Retorna o limite de contexto (context window) para um modelo específico.
   * Se o modelo não estiver mapeado em DEFAULT_CONTEXT_WINDOWS, retorna
   * 4096 como fallback conservador.
   *
   * @param model  Nome/tag do modelo (ex.: "llama3.2:1b").
   * @returns      Limite máximo de tokens.
   */
  static getLimit(model: string): number {
    return DEFAULT_CONTEXT_WINDOWS[model] ?? FALLBACK_LIMIT;
  }
}
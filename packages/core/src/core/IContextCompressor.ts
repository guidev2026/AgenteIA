/**
 * IContextCompressor: Contrato para compressão de contexto (ISP + DIP).
 *
 * Responsabilidade Única: Definir o contrato de compressão de histórico
 * de mensagens ReAct, sem qualquer lógica de I/O.
 *
 * - workingMemory: bloco consolidado do histórico (sumarização/compressão)
 * - keptMessages: últimas N mensagens preservadas intactas (mínimo última resposta do assistente)
 * - compressionRatio: 0.0 (sem compressão) a 1.0 (100% comprimido), para logging
 */

import type { ReActMessage } from './rag/ReActLoop';

/**
 * Resultado da compressão de contexto.
 */
export interface CompressedContext {
  /** Bloco consolidado com o histórico comprimido/sumarizado */
  workingMemory: string;
  /** Últimas N mensagens preservadas intactas (mínimo última resposta do assistente) */
  keptMessages: ReActMessage[];
  /** Taxa de compressão: 0.0 (sem compressão) a 1.0 (100% comprimido) */
  compressionRatio: number;
}

/**
 * Gatilhos de compressão baseados na porcentagem de uso do contexto.
 */
export enum CompressionTrigger {
  /** Nenhuma compressão necessária */
  NONE = 'NONE',
  /** Compressão suave: >= 70% do contexto usado */
  SOFT = 'SOFT',
  /** Compressão agressiva: >= 85% do contexto usado */
  HARD = 'HARD',
}

/**
 * Avalia a necessidade de compressão baseada na proporção de tokens estimados
 * versus o limite máximo de contexto do modelo.
 *
 * @param estimatedTokens - Quantidade estimada de tokens no histórico atual
 * @param contextLimit - Limite máximo de tokens de contexto do modelo
 * @returns CompressionTrigger indicando o nível de compressão necessário
 *
 * @example
 * ```ts
 * assessCompressionNeed(690, 1000) // 69% → CompressionTrigger.NONE
 * assessCompressionNeed(700, 1000) // 70% → CompressionTrigger.SOFT
 * assessCompressionNeed(850, 1000) // 85% → CompressionTrigger.HARD
 * ```
 */
export function assessCompressionNeed(
  estimatedTokens: number,
  contextLimit: number,
): CompressionTrigger {
  if (contextLimit <= 0) {
    return CompressionTrigger.NONE;
  }

  const ratio = estimatedTokens / contextLimit;

  if (ratio >= 0.85) {
    return CompressionTrigger.HARD;
  }

  if (ratio >= 0.70) {
    return CompressionTrigger.SOFT;
  }

  return CompressionTrigger.NONE;
}

/**
 * Interface para implementadores do compressor de contexto (DIP).
 */
export interface IContextCompressor {
  /**
   * Comprime o histórico de mensagens ReAct.
   *
   * @param history - Array completo de mensagens do histórico
   * @param model - Identificador do modelo sendo usado (para limites de contexto)
   * @param systemPrompt - Prompt de sistema original
   * @returns Promise com o contexto comprimido
   */
  compress(
    history: ReActMessage[],
    model: string,
    systemPrompt: string,
  ): Promise<CompressedContext>;
}
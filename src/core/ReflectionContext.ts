/**
 * IReflectionContext: Interface formal para contexto de reflexão (DIP).
 *
 * TASK 8: Substitui o acoplamento de parâmetros soltos (model, reflectFlag)
 * por uma interface explícita que encapsula todas as opções de reflexão.
 *
 * SRP: Apenas define o contrato — não contém lógica de execução.
 * ISP: Clientes recebem apenas o que precisam (não dependem de interfaces inchadas).
 * DIP: O ReActLoop depende desta abstração, não de parâmetros concretos.
 */

import type { CorrectionStatus } from '../providers/types';

/**
 * Contexto de reflexão: parâmetros que controlam o comportamento
 * do Reflector durante a auto-correção.
 */
export interface IReflectionContext {
  /** Se true, aplica Reflexão pós-resposta */
  enabled: boolean;
  /** Nome do modelo (para logging/journal) */
  model: string;
  /** Temperatura do crítico (default 0.1 — baixa = mais determinístico) */
  temperature?: number;
  /** Se true, exibe logs detalhados no stderr */
  verbose?: boolean;
}

/**
 * Resultado completo da reflexão (mesmo que ReflectionResult, mas com
 * semântica de contexto para consistência).
 */
export interface ReflectionContextResult {
  finalContent: string;
  correctionStatus: CorrectionStatus;
  errors: Array<{
    type: 'hallucination' | 'syntax' | 'inconsistency' | 'logic';
    description: string;
  }>;
}
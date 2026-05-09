/**
 * Reflector: Módulo de auto-correção (Self-Correction Layer).
 *
 * Responsabilidade Única (SRP):
 * - Receber uma resposta gerada pelo modelo
 * - Submetê-la a um sistema de crítica (segunda chamada ao provider)
 * - Retornar a versão corrigida, se necessário
 *
 * O Reflector NÃO modifica o ReActLoop — ele é um step opcional
 * acionado APÓS a resposta final ser obtida.
 *
 * Zero dependências externas — usa apenas ICritiqueProvider injetado.
 * Compatível com recursos limitados (12GB RAM): reusa o mesmo modelo,
 * sem duplicar contexto do histórico ReAct.
 */

import type { ICritiqueProvider, CorrectionStatus } from '../providers/types';

// ── Interfaces públicas ──

/** Erro individual encontrado pelo crítico */
export interface ReflectionError {
  type: 'hallucination' | 'syntax' | 'inconsistency' | 'logic';
  description: string;
}

/** Resultado completo da reflexão */
export interface ReflectionResult {
  /** Conteúdo final (corrigido ou original) */
  finalContent: string;
  /** Status da correção ('stable' | 'suspicious' | 'rejected') */
  correctionStatus: CorrectionStatus;
  /** Lista de erros encontrados (vazia se nenhum) */
  errors: ReflectionError[];
}

// ── System Prompt de Crítica ──

/**
 * Prompt de crítica otimizado (TASK 9).
 *
 * Otimizações:
 * - Reduzido de ~40 linhas para ~20 linhas (menos tokens consumidos)
 * - Prioriza exemplos concretos vs regras genéricas
 * - Usa verbos imperativos no início de cada seção
 * - Formato JSON simplificado
 * - Removeu seções redundantes (contradições lógicas fundidas com alucinações)
 */
const CRITICAL_SYSTEM_PROMPT = `Analise criticamente a resposta abaixo.

REGRAS:
- Alucinação: API/biblioteca/função que não existe no Node.js nativo
- Erro sintaxe: JSON inválido, await sem async, chaves desbalanceadas
- Ferramenta inválida: usar {TOOLS_LIST} com nome ou parâmetro errado

FORMATO RESPOSTA (JSON puro, sem markdown):
{"hasError":bool,"errors":[{"type":"hallucination|syntax|inconsistency|logic","description":"string"}],"correctedOutput":"string"}

REGRAS EXTRAS:
- Se não houver erro: hasError=false, correctedOutput=resposta original
- NÃO invente erros nem adicione info nova na correção`;

/**
 * Reflector: Executa uma chamada de crítica sobre a resposta gerada.
 *
 * Fluxo:
 *   1. Monta prompt de crítica com as tools disponíveis
 *   2. Chama critiqueProvider.critique() (via ICritiqueProvider)
 *   3. Parseia o JSON de retorno
 *   4. Decide se houve correção e retorna ReflectionResult
 *
 * SRP: Apenas reflexão crítica. Não gerencia histórico, não executa ferramentas.
 * LSP: Usa ICritiqueProvider em vez de IProvider — o Reflector não precisa
 *      de chat() genérico, apenas do método critique() especializado.
 */
export class Reflector {
  /**
   * @param critiqueProvider Provider especializado para crítica de respostas
   * @param toolRegistry Registro de ferramentas (para listar tools disponíveis)
   * @throws Error se critiqueProvider não for fornecido
   */
  constructor(
    private readonly critiqueProvider: ICritiqueProvider,
    private readonly toolRegistry: { getToolNames(): string[] }
  ) {
    if (!critiqueProvider) {
      throw new Error('Reflector: critiqueProvider é obrigatório');
    }
    if (!toolRegistry) {
      throw new Error('Reflector: toolRegistry é obrigatório');
    }
  }

  /**
   * Submete a resposta do modelo à crítica e retorna o resultado.
   *
   * @param rawAnswer Resposta original gerada pelo modelo
   * @param model     Nome do modelo (mesmo usado na geração)
   * @returns         Resultado da reflexão (corrigido ou original)
   */
  async reflect(rawAnswer: string, model: string): Promise<ReflectionResult> {
    // Se a resposta é vazia ou só espaços, não perde tempo com crítica
    const trimmed = rawAnswer.trim();
    if (!trimmed) {
      return {
        finalContent: '',
        correctionStatus: 'stable',
        errors: [],
      };
    }

    // Monta o prompt de crítica com a lista de tools disponíveis
    const toolsList = this.toolRegistry.getToolNames().join(', ');
    const criticalPrompt = CRITICAL_SYSTEM_PROMPT.replace('{TOOLS_LIST}', toolsList);

    const fullPrompt = `${criticalPrompt}\n\n## RESPOSTA A SER ANALISADA\n\n${rawAnswer}\n\n## ANÁLISE`;

    try {
      // Usa critique() em vez de chat() — mais específico e com melhor controle
      const critiqueResponse = await this.critiqueProvider.critique({
        model,
        prompt: fullPrompt,
        temperature: 0.1, // Baixa temperatura = mais determinístico
      });

      const content = critiqueResponse.parsedJson;

      const hasError = content.hasError === true;
      const errors = this.parseErrors(content.errors);
      const correctedOutput = content.correctedOutput as string | undefined;

      // ── CIRCUIT BREAKER (TASK 3) ──
      // Valida a qualidade da correção antes de aceitá-la
      if (hasError && correctedOutput && correctedOutput.trim().length > 0) {
        const similarity = this.computeSimilarity(rawAnswer, correctedOutput);

        // Se a correção é quase idêntica ao original (>90% similaridade),
        // o crítico provavelmente gerou um falso positivo
        if (similarity > 0.9) {
          return {
            finalContent: rawAnswer, // Mantém original
            correctionStatus: 'suspicious', // Sinaliza suspeita
            errors, // Mantém erros reportados para transparência
          };
        }

        // Se a correção mudou significativamente (<20% similaridade),
        // pode ser alucinação do crítico — descarta a correção
        if (similarity < 0.2) {
          return {
            finalContent: rawAnswer, // Mantém original
            correctionStatus: 'suspicious',
            errors,
          };
        }

        // Correção válida: mudança moderada e com erros reportados
        return {
          finalContent: correctedOutput,
          correctionStatus: 'stable',
          errors,
        };
      }

      // Sem erros → mantém original (stable)
      return {
        finalContent: rawAnswer,
        correctionStatus: 'stable',
        errors,
      };
    } catch {
      // Timeout ou erro de conexão → retorna original sem reflexão
      return {
        finalContent: rawAnswer,
        correctionStatus: 'rejected',
        errors: [],
      };
    }
  }

  /**
   * Calcula similaridade entre duas strings usando Dice Coefficient
   * sobre bigramas — leve, rápido e eficaz para detectar mudanças reais.
   *
   * Circuit Breaker: evita que falsos positivos do crítico (hasError=true
   * com mudança mínima) ou alucinações (mudança drástica) contaminem
   * a resposta final.
   *
   * @returns Valor entre 0 (completamente diferente) e 1 (idêntico)
   */
  private computeSimilarity(a: string, b: string): number {
    const bigrams = (s: string): Set<string> => {
      const set = new Set<string>();
      const normalized = s.toLowerCase().replace(/\s+/g, ' ').trim();
      for (let i = 0; i < normalized.length - 1; i++) {
        set.add(normalized.slice(i, i + 2));
      }
      return set;
    };

    const bigramsA = bigrams(a);
    const bigramsB = bigrams(b);

    if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

    let intersection = 0;
    for (const bigram of bigramsA) {
      if (bigramsB.has(bigram)) intersection++;
    }

    return (2 * intersection) / (bigramsA.size + bigramsB.size);
  }

  /**
   * Parseia o array de erros do JSON, validando o formato.
   */
  private parseErrors(raw: unknown): ReflectionError[] {
    if (!Array.isArray(raw)) return [];

    return raw.filter((item): item is ReflectionError => {
      if (!item || typeof item !== 'object') return false;
      const e = item as Record<string, unknown>;
      const validTypes = ['hallucination', 'syntax', 'inconsistency', 'logic'];
      return (
        typeof e.type === 'string' &&
        validTypes.includes(e.type) &&
        typeof e.description === 'string'
      );
    });
  }
}
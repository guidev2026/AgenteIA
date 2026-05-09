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
 * Zero dependências externas — usa apenas IProvider injetado.
 * Compatível com recursos limitados (12GB RAM): reusa o mesmo modelo,
 * sem duplicar contexto do histórico ReAct.
 */

import type { IProvider } from '../providers/types';

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
  /** Se houve correção */
  wasCorrected: boolean;
  /** Lista de erros encontrados (vazia se nenhum) */
  errors: ReflectionError[];
}

// ── System Prompt de Crítica ──

const CRITICAL_SYSTEM_PROMPT = `Você é um revisor crítico de respostas geradas por IA.
Sua função é analisar a resposta abaixo e identificar problemas.

## REGRAS DE ANÁLISE

### 1. Alucinações de API/Libraries
- Detecte menções a bibliotecas ou APIs que não existem
  (ex: "navigator.onInputError", "fs.readJsonSync")
- Detecte imports de módulos inexistentes
  (ex: "import { x } from 'react-ghost'")
- Detecte funções padrão do Node.js chamadas com nomes errados
  (use apenas: node:fs, node:path, node:http, node:child_process,
   node:crypto, node:buffer)

### 2. Erros de Sintaxe
- Blocos de código com syntax inválida
  (ex: chaves desbalanceadas, await fora de async function)
- TypeScript com tipos claramente errados
  (ex: usar "any" onde há interface definida, tipos que não existem)

### 3. Inconsistências com Ferramentas Disponíveis
- Ferramentas disponíveis: {TOOLS_LIST}
- Se a resposta sugere usar uma ferramenta que NÃO está na lista, é erro
- Se a resposta inventa parâmetros que as ferramentas não aceitam, é erro

### 4. Contradições Lógicas
- A resposta se contradiz internamente?
- A resposta afirma algo factualmente impossível?

## FORMATO DE RESPOSTA (JSON estrito — sem markdown, sem comentários)

{
  "hasError": true ou false,
  "errors": [
    {
      "type": "hallucination" | "syntax" | "inconsistency" | "logic",
      "description": "Descrição clara do problema encontrado"
    }
  ],
  "correctedOutput": "Versão corrigida da resposta (igual à original se hasError=false)"
}

IMPORTANTE:
- Se NÃO houver erros, hasError=false e correctedOutput = resposta original EXATA
- Se houver erros, correctedOutput deve ser a versão corrigida
- NÃO invente erros onde não existem
- NÃO adicione informações novas em correctedOutput
- NÃO use formatação markdown na resposta, apenas JSON puro`;

/**
 * Reflector: Executa uma chamada de crítica sobre a resposta gerada.
 *
 * Fluxo:
 *   1. Monta prompt de crítica com as tools disponíveis
 *   2. Chama provider.chat() com temperature baixa e format: 'json'
 *   3. Parseia o JSON de retorno
 *   4. Decide se houve correção e retorna ReflectionResult
 *
 * SRP: Apenas reflexão crítica. Não gerencia histórico, não executa ferramentas.
 */
export class Reflector {
  /**
   * @param provider Provider para fazer a chamada de crítica
   * @param toolRegistry Registro de ferramentas (para listar tools disponíveis)
   * @throws Error se provider não for fornecido
   */
  constructor(
    private readonly provider: IProvider,
    private readonly toolRegistry: { getToolNames(): string[] }
  ) {
    if (!provider) {
      throw new Error('Reflector: provider é obrigatório');
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
        wasCorrected: false,
        errors: [],
      };
    }

    // Monta o prompt de crítica com a lista de tools disponíveis
    const toolsList = this.toolRegistry.getToolNames().join(', ');
    const criticalPrompt = CRITICAL_SYSTEM_PROMPT.replace('{TOOLS_LIST}', toolsList);

    const fullPrompt = `${criticalPrompt}\n\n## RESPOSTA A SER ANALISADA\n\n${rawAnswer}\n\n## ANÁLISE`;

    try {
      const response = await this.provider.chat({
        model,
        prompt: fullPrompt,
        temperature: 0.1, // Baixa temperatura = mais determinístico
        format: 'json',
      });

      const content = response.response.trim();

      // Tenta parsear o JSON de retorno
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Se não for JSON válido, retorna sem correção (fallback seguro)
        return {
          finalContent: rawAnswer,
          wasCorrected: false,
          errors: [],
        };
      }

      const hasError = parsed.hasError === true;
      const errors = this.parseErrors(parsed.errors);
      const correctedOutput = parsed.correctedOutput as string | undefined;

      // Decisão: corrige apenas se hasError=true e correctedOutput é válido
      if (hasError && correctedOutput && correctedOutput.trim().length > 0) {
        return {
          finalContent: correctedOutput,
          wasCorrected: true,
          errors,
        };
      }

      // Sem erros ou correção inválida → mantém original
      return {
        finalContent: rawAnswer,
        wasCorrected: false,
        errors,
      };
    } catch {
      // Timeout ou erro de conexão → retorna original sem reflexão
      return {
        finalContent: rawAnswer,
        wasCorrected: false,
        errors: [],
      };
    }
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
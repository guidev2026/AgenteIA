/**
 * PromptBuilder: Fábrica de prompts do sistema (SRP).
 *
 * Responsabilidade Única:
 * - Montar o system prompt completo com instruções ReAct + tools
 * - Injetar a flag de JSON strict quando solicitado
 * - Formatar mensagens de histórico
 *
 * Não executa o loop ReAct, não chama o provider.
 * Apenas constrói strings de prompt.
 */

import type { ReActMessage } from './ReActLoop';

export interface PromptConfig {
  /** Tools disponíveis (JSON Schema string) */
  toolsDefinition?: string;
  /** Forçar resposta em JSON estrito */
  jsonStrict?: boolean;
  /** Contexto RAG (documentos relevantes encontrados) */
  ragContext?: string;
}

export class PromptBuilder {
  /**
   * Constrói o system prompt completo, mesclando:
   * - A identidade base do assistente
   * - Instruções ReAct (Thought → Action → Observation → Final Answer)
   * - Definição das tools disponíveis
   * - Flag de JSON strict se ativada
   * - Contexto RAG (documentos relevantes)
   */
  buildSystemPrompt(config: PromptConfig = {}): string {
    const parts: string[] = [];

    // 1. Identidade base
    parts.push(
      'Você é o Agente Soberano, um assistente de IA especializado em ' +
      'auxiliar com tarefas de desenvolvimento, análise de código, ' +
      'administração de sistemas e engenharia de software.'
    );

    // 2. Instruções ReAct
    parts.push(
      'FORMATO DE RESPOSTA: Use o formato ReAct (Reasoning + Acting):\n' +
      '1. THOUGHT: Raciocine sobre o problema passo a passo\n' +
      '2. ACTION: Se precisar executar um comando ou ferramenta, ' +
      'escreva ACTION seguido do comando\n' +
      '3. OBSERVATION: O sistema executará a ação e retornará o resultado\n' +
      '4. FINAL_ANSWER: Quando tiver informações suficientes, ' +
      'entregue a resposta final'
    );

    // 3. Se tem tools, adiciona a definição
    if (config.toolsDefinition) {
      parts.push(
        'FERRAMENTAS DISPONÍVEIS:\n' +
        config.toolsDefinition +
        '\n\nPara usar uma ferramenta, escreva ACTION seguido do nome ' +
        'da ferramenta e seus argumentos no formato JSON.'
      );
    }

    // 4. Contexto RAG (documentos relevantes encontrados)
    if (config.ragContext) {
      parts.push(
        'CONTEXTO DOS DOCUMENTOS:\n' +
        config.ragContext +
        '\n\nUse estas informações para responder com precisão ' +
        'sobre o código-fonte e documentação do projeto.'
      );
    }

    // 5. JSON Strict — injeta automaticamente quando flag está ativa
    if (config.jsonStrict) {
      parts.push(
        'Responda estritamente em formato JSON válido.'
      );
    }

    return parts.join('\n\n');
  }

  /**
   * Serializa histórico de mensagens no formato texto
   * para ser usado como prompt único (necessário para providers
   * que não suportam nativamente multi-turn, como Ollama API /api/generate).
   */
  serializeHistory(history: ReActMessage[]): string {
    return history
      .map((msg) => `[${msg.role.toUpperCase()}]: ${msg.content}`)
      .join('\n\n');
  }
}
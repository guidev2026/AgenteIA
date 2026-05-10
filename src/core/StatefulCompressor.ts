/**
 * StatefulCompressor: Implementação do IContextCompressor que usa o próprio
 * modelo de linguagem para condensar o histórico (SRP + DIP).
 *
 * Responsabilidade Única: Pegar um histórico longo de mensagens ReAct e
 * pedir ao modelo que extraia três blocos essenciais (objective, completed,
 * critical_rules), descartando o lixo da conversa e preservando o essencial.
 *
 * ISP (Interface Segregation): Depende apenas de IContextCompressor e IProvider.
 * DIP (Dependency Inversion): Recebe IProvider via construtor, não instancia nada.
 */

import type { IContextCompressor, CompressedContext } from './IContextCompressor';
import type { IProvider } from '../providers/types';
import type { ReActMessage } from './rag/ReActLoop';

/** Número de mensagens finais mantidas intactas após compressão */
const KEEP_LAST = 3;

/**
 * Sistema de prompt usado para instruir o modelo a extrair os três blocos.
 */
const COMPRESSION_SYSTEM_PROMPT = `You are a conversation compression assistant.
Your task is to analyze the ReAct conversation history below and extract three critical pieces of information.

Respond with a JSON object ONLY (no markdown, no code fences), containing exactly these three fields:
{
  "objective": "What the user is trying to achieve — the main goal and intent",
  "completed": "What has already been successfully executed — actions taken, tools used, results obtained",
  "critical_rules": "Constraints, business rules, preferences, or restrictions mentioned during the conversation"
}

Guidelines:
- Be concise but complete. Preserve all important details.
- objective: Focus on the user's end goal, not intermediate steps.
- completed: List concrete accomplishments, commands run, files created, etc.
- critical_rules: Include any constraints about tools, formats, dependencies, or behavior.
- If a section has no content, use an empty string.
- Return ONLY valid JSON, no other text.`;

/**
 * Formata o histórico como texto para enviar ao modelo.
 */
function formatHistoryForCompression(history: ReActMessage[]): string {
  return history
    .map((msg) => {
      const prefix = msg.role === 'user' ? 'USER' : msg.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
      return `[${prefix}]\n${msg.content}`;
    })
    .join('\n\n');
}

/**
 * Formata o JSON parseado como Markdown estruturado para workingMemory.
 */
function formatWorkingMemory(
  objective: string,
  completed: string,
  criticalRules: string,
): string {
  const parts: string[] = [];

  if (objective) {
    parts.push(`## Objective\n${objective}`);
  }

  if (completed) {
    parts.push(`## Completed\n${completed}`);
  }

  if (criticalRules) {
    parts.push(`## Critical Rules\n${criticalRules}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '*(compressed context — no significant content extracted)*';
}

/**
 * Calcula a taxa de compressão: 0.0 (sem compressão) a 1.0 (100% comprimido).
 *
 * @param originalLength - Tamanho total do histórico original em caracteres
 * @param compressedLength - Tamanho do workingMemory em caracteres
 * @returns Taxa de compressão entre 0.0 e 1.0
 */
function computeCompressionRatio(originalLength: number, compressedLength: number): number {
  if (originalLength <= 0) return 0.0;
  const ratio = 1.0 - compressedLength / originalLength;
  // Clamp between 0.0 and 1.0
  return Math.max(0.0, Math.min(1.0, ratio));
}

export class StatefulCompressor implements IContextCompressor {
  private readonly provider: IProvider;

  constructor(provider: IProvider) {
    this.provider = provider;
  }

  /**
   * Comprime o histórico de mensagens ReAct usando o modelo de linguagem.
   *
   * @param history - Array completo de mensagens do histórico
   * @param _model - Identificador do modelo sendo usado (não usado diretamente, delegado ao provider)
   * @param _systemPrompt - Prompt de sistema original (usado como contexto adicional)
   * @returns Promise com o contexto comprimido
   */
  async compress(
    history: ReActMessage[],
    _model: string,
    _systemPrompt: string,
  ): Promise<CompressedContext> {
    // Sempre preservar as últimas KEEP_LAST mensagens intactas
    const keptMessages = history.slice(-KEEP_LAST);
    const historicalMessages = history.slice(0, -KEEP_LAST);

    // Se não há histórico suficiente para comprimir, retorna sem compressão
    if (historicalMessages.length === 0) {
      return {
        workingMemory: '',
        keptMessages: history,
        compressionRatio: 1.0,
      };
    }

    const originalTotalLength = history.reduce((acc, msg) => acc + msg.content.length, 0);
    const formattedHistory = formatHistoryForCompression(historicalMessages);

    // Prompt completo: system prompt + histórico + instrução de formato
    const fullPrompt = `${COMPRESSION_SYSTEM_PROMPT}\n\nConversation history:\n${formattedHistory}`;

    try {
      const response = await this.provider.chat({
        model: _model,
        prompt: fullPrompt,
        temperature: 0.1,
        format: 'json',
      });

      // Parse da resposta JSON
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(response.response);
      } catch {
        // Falha no parse JSON — loga erro e retorna sem compressão
        console.error(
          `[StatefulCompressor] JSON parse error: resposta do modelo não é JSON válido. Resposta bruta: ${response.response.substring(0, 200)}`,
        );
        return {
          workingMemory: '',
          keptMessages: history,
          compressionRatio: 1.0,
        };
      }

      // Extrair campos (com fallback para string vazia)
      const objective = typeof parsed.objective === 'string' ? parsed.objective : '';
      const completed = typeof parsed.completed === 'string' ? parsed.completed : '';
      const criticalRules = typeof parsed.critical_rules === 'string' ? parsed.critical_rules : '';

      const workingMemory = formatWorkingMemory(objective, completed, criticalRules);
      const compressedLength = workingMemory.length;
      const compressionRatio = computeCompressionRatio(originalTotalLength, compressedLength);

      return {
        workingMemory,
        keptMessages,
        compressionRatio,
      };
    } catch (err) {
      // Provider lançou exceção — loga erro e retorna sem compressão
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[StatefulCompressor] Provider error: ${errorMessage}`);
      return {
        workingMemory: '',
        keptMessages: history,
        compressionRatio: 1.0,
      };
    }
  }
}
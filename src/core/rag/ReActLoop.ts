/**
 * ReActLoop: Execução do ciclo Reasoning + Acting (SRP).
 *
 * Responsabilidade Única: Gerenciar o loop de interação ReAct:
 * 1. Concatena histórico de mensagens em um prompt único
 * 2. Envia para o provider e interpreta ações vs resposta final
 * 3. Se conter ACTION, executa via CommandExecutor e realimenta o prompt
 * 4. Se conter FINAL_ANSWER, retorna
 *
 * Compatível com IProvider.chat(request: ChatRequest): ChatResponse
 * (prompt único, não array de mensagens — formata tudo inline)
 */

import type { IProvider } from '../../providers/types';
import type { CommandExecutor } from '../CommandExecutor';

const MAX_ITERATIONS = 10;

export interface ReActMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ReActResult {
  finalAnswer: string;
  iterations: number;
}

export class ReActLoop {
  private provider: IProvider;
  private executor: CommandExecutor;

  constructor(
    provider: IProvider,
    executor: CommandExecutor
  ) {
    this.provider = provider;
    this.executor = executor;
  }

  /**
   * Concatena o histórico de mensagens em um único prompt texto,
   * no formato esperado pelo Ollama (system + user/assistant turns).
   */
  private buildPrompt(
    systemPrompt: string,
    history: ReActMessage[]
  ): string {
    const parts: string[] = [systemPrompt];

    for (const msg of history) {
      switch (msg.role) {
        case 'system':
          parts.push(`[SYSTEM]: ${msg.content}`);
          break;
        case 'user':
          parts.push(`[USER]: ${msg.content}`);
          break;
        case 'assistant':
          parts.push(`[ASSISTANT]: ${msg.content}`);
          break;
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Executa o loop ReAct até encontrar FINAL_ANSWER
   * ou atingir o limite de iterações.
   *
   * @param systemPrompt Prompt de sistema injetado automaticamente
   * @param history Histórico de mensagens da conversa
   * @param model Modelo a ser usado (opcional)
   * @returns Resultado com resposta final e número de iterações
   */
  async execute(
    systemPrompt: string,
    history: ReActMessage[],
    model?: string
  ): Promise<ReActResult> {
    let iteration = 0;
    let finalAnswer = '';

    // Concatena todo o contexto em um prompt único
    let prompt = this.buildPrompt(systemPrompt, history);

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // 1. Envia prompt para o modelo
      const response = await this.provider.chat({
        model: model ?? 'tinyllama:1b',
        prompt,
        temperature: 0.3, // mais baixa para respostas mais determinísticas no ReAct
      });
      const content = response.response.trim();

      // 2. Verifica se é resposta final
      if (content.includes('FINAL_ANSWER') || content.includes('FINAL ANSWER')) {
        finalAnswer = content;
        break;
      }

      // 3. Se contém ACTION, tenta executar
      if (content.includes('ACTION') || content.includes('ACTION:')) {
        // Extrai o comando após ACTION:
        const actionMatch = content.match(/ACTION:?\s*(.+)/s);
        if (actionMatch) {
          const action = actionMatch[1].trim();
          // Separa comando dos argumentos (split por espaço)
          const parts = action.split(/\s+/);
          const cmd = parts[0];
          const args = parts.slice(1);

          try {
            const result = await this.executor.execute(cmd, args, { timeout: 30000 });
            const observation =
              `OBSERVATION: Exit code ${result.exitCode}\n` +
              (result.stdout ? `STDOUT:\n${result.stdout}\n` : '') +
              (result.stderr ? `STDERR:\n${result.stderr}\n` : '');

            // Alimenta o prompt com o resultado da ação
            prompt += `\n\n[ASSISTANT]: ${content}\n[SYSTEM]: ${observation}`;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            prompt += `\n\n[ASSISTANT]: ${content}\n[SYSTEM]: OBSERVATION: Error executing action: ${errMsg}`;
          }
          continue;
        }
      }

      // 4. Se não identificou nem ACTION nem FINAL_ANSWER,
      //    assume que é pensamento contínuo — alimenta o prompt
      prompt += `\n\n[ASSISTANT]: ${content}`;

      // Proteção: resposta muito curta pode indicar loop infinito
      if (content.length < 10 && iteration > 1) {
        finalAnswer = 'Resumo: ' + content;
        break;
      }
    }

    if (!finalAnswer) {
      // Fallback: retorna todo o conteúdo gerado como resposta
      const lastAssistant = prompt.match(/\[ASSISTANT\]:\s*(.+?)(?=\n\[|$)/s);
      finalAnswer = lastAssistant
        ? lastAssistant[1].trim()
        : 'O modelo não conseguiu chegar a uma resposta final.';
    }

    return {
      finalAnswer,
      iterations: iteration,
    };
  }
}
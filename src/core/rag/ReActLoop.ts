/**
 * ReActLoop: Execução do ciclo Reasoning + Acting (SRP).
 *
 * Responsabilidade Única: Gerenciar o loop de interação ReAct:
 * 1. Concatena histórico de mensagens em um prompt único
 * 2. Envia para o provider e interpreta ações vs resposta final
 * 3. Se for JSON mode (--json), usa ToolRegistry + formato tool_call/final_response
 * 4. Se for modo texto, usa ACTION/FINAL_ANSWER + CommandExecutor
 *
 * Compatível com IProvider.chat(request: ChatRequest): ChatResponse
 * (prompt único, não array de mensagens — formata tudo inline)
 */

import type { IProvider } from '../../providers/types';
import type { CommandExecutor } from '../CommandExecutor';
import type { ToolRegistry } from '../ToolRegistry';
import type { Reflector, ReflectionResult, ReflectionError } from '../Reflector';
import { JsonValidator } from '../../validation/JsonValidator';
import { PromptBuilder } from './PromptBuilder';
import type { PromptConfig } from './PromptBuilder';

const MAX_ITERATIONS = 5;

export interface ReActMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ReActResult {
  finalAnswer: string;
  iterations: number;
  /** Status da correção do Reflector */
  correctionStatus?: 'stable' | 'suspicious' | 'rejected';
  /** Erros encontrados pelo Reflector (vazio se não houve reflexão) */
  errors?: ReflectionError[];
}

export class ReActLoop {
  private provider: IProvider;
  private executor?: CommandExecutor;
  private toolRegistry?: ToolRegistry;
  private reflector?: Reflector;
  private jsonValidator: JsonValidator;
  private promptBuilder: PromptBuilder;

  constructor(
    provider: IProvider,
    executor?: CommandExecutor,
    toolRegistry?: ToolRegistry,
    reflector?: Reflector
  ) {
    this.provider = provider;
    this.executor = executor;
    this.toolRegistry = toolRegistry;
    this.reflector = reflector;
    this.jsonValidator = new JsonValidator();
    this.promptBuilder = new PromptBuilder();
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
   * Executa o loop ReAct no modo JSON (tool_call / final_response).
   * Usado quando --json está ativo. Usa ToolRegistry + detecção de loop.
   */
  private async executeJsonMode(
    systemPrompt: string,
    history: ReActMessage[],
    model: string
  ): Promise<ReActResult> {
    let accumulatedPrompt = this.buildPrompt(systemPrompt, history);
    let lastToolCall = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const promptForThisIteration =
        i === MAX_ITERATIONS - 1
          ? accumulatedPrompt +
            '\n\nATENÇÃO: Esta é sua ÚLTIMA iteração. Você JÁ possui todos os ' +
            'dados necessários. Responda APENAS com ' +
            '{"final_response": "<sua resposta baseada nos dados coletados>"}. ' +
            'NÃO chame mais ferramentas.'
          : accumulatedPrompt;

      const response = await this.provider.chat({
        model,
        prompt: promptForThisIteration,
        temperature: 0.2,
        format: 'json',
      });

      const content = response.response.trim();

      // Usa JsonValidator para parsear
      const parsed = this.jsonValidator.tryValidate<Record<string, unknown>>(content);
      if (!parsed) {
        // Se não for JSON, retorna cru como fallback
        return {
          finalAnswer: content,
          iterations: i + 1,
        };
      }

      // tool_call → executa e continua
      if (parsed.tool_call && typeof parsed.tool_call === 'string' && this.toolRegistry) {
        const toolName = parsed.tool_call;
        const toolArgs = (parsed.args as Record<string, unknown>) || {};
        const callFingerprint = `${toolName}:${JSON.stringify(toolArgs)}`;

        // Detecta chamadas repetidas consecutivas (loop infinito)
        if (callFingerprint === lastToolCall && i < MAX_ITERATIONS - 1) {
          accumulatedPrompt +=
            `\n\nATENÇÃO: Você já chamou "${toolName}" com os mesmos ` +
            'argumentos. Use os dados já recebidos e responda com ' +
            '{"final_response": "<resposta>"}.';
          lastToolCall = '';
          continue;
        }

        lastToolCall = callFingerprint;

        let toolResult: string;
        try {
          toolResult = await this.toolRegistry.execute(toolName, toolArgs);
        } catch (err: unknown) {
          toolResult = err instanceof Error ? err.message : String(err);
        }

        accumulatedPrompt += `\n\nResultado da ferramenta ${toolName}: ${toolResult}`;
        continue;
      }

      // final_response → retorna
      if (parsed.final_response && typeof parsed.final_response === 'string') {
        return {
          finalAnswer: parsed.final_response,
          iterations: i + 1,
        };
      }

      // Formato desconhecido → fallback
      return {
        finalAnswer: content,
        iterations: i + 1,
      };
    }

    // Loop esgotado
    return {
      finalAnswer: 'O modelo não conseguiu chegar a uma resposta final após ' +
        `${MAX_ITERATIONS} iterações.`,
      iterations: MAX_ITERATIONS,
    };
  }

  /**
   * Executa o loop ReAct no modo texto (ACTION / FINAL_ANSWER).
   * Formato legado, sem JSON.
   */
  private async executeTextMode(
    systemPrompt: string,
    history: ReActMessage[],
    model: string
  ): Promise<ReActResult> {
    let iteration = 0;
    let finalAnswer = '';
    let prompt = this.buildPrompt(systemPrompt, history);

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const response = await this.provider.chat({
        model,
        prompt,
        temperature: 0.3,
      });
      const content = response.response.trim();

      if (content.includes('FINAL_ANSWER') || content.includes('FINAL ANSWER')) {
        finalAnswer = content;
        break;
      }

      if (this.executor && (content.includes('ACTION') || content.includes('ACTION:'))) {
        const actionMatch = content.match(/ACTION:?\s*(.+)/s);
        if (actionMatch) {
          const action = actionMatch[1].trim();
          const parts = action.split(/\s+/);
          const cmd = parts[0];
          const args = parts.slice(1);

          try {
            const result = await this.executor.execute(cmd, args, { timeout: 30000 });
            const observation =
              `OBSERVATION: Exit code ${result.exitCode}\n` +
              (result.stdout ? `STDOUT:\n${result.stdout}\n` : '') +
              (result.stderr ? `STDERR:\n${result.stderr}\n` : '');
            prompt += `\n\n[ASSISTANT]: ${content}\n[SYSTEM]: ${observation}`;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            prompt += `\n\n[ASSISTANT]: ${content}\n[SYSTEM]: OBSERVATION: Error executing action: ${errMsg}`;
          }
          continue;
        }
      }

      prompt += `\n\n[ASSISTANT]: ${content}`;

      if (content.length < 10 && iteration > 1) {
        finalAnswer = 'Resumo: ' + content;
        break;
      }
    }

    if (!finalAnswer) {
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

  /**
   * Aplica o Reflector na resposta final, se disponível e solicitado.
   */
  private async applyReflection(
    result: ReActResult,
    model: string,
    reflectFlag: boolean
  ): Promise<ReActResult> {
    // Só aplica reflexão se:
    // 1. A flag --reflect está ativa
    // 2. O Reflector foi injetado
    // 3. Há uma resposta real (não vazia)
    if (!reflectFlag || !this.reflector || !result.finalAnswer) {
      return result;
    }

    const reflection = await this.reflector.reflect(result.finalAnswer, model);

    return {
      finalAnswer: reflection.finalContent,
      iterations: result.iterations,
      correctionStatus: reflection.correctionStatus,
      errors: reflection.errors,
    };
  }

  /**
   * Ponto de entrada: executa o loop ReAct no modo apropriado.
   *
   * @param systemPrompt Prompt de sistema
   * @param history Histórico de mensagens
   * @param model Modelo (default: tinyllama:1b)
   * @param options.jsonMode Se true, usa JSON mode (tool_call/final_response)
   * @param options.reflect Se true, aplica Reflector pós-resposta (self-correction)
   * @returns Resultado com resposta final e número de iterações
   */
  async execute(
    systemPrompt: string,
    history: ReActMessage[],
    model?: string,
    options?: { jsonMode?: boolean; reflect?: boolean }
  ): Promise<ReActResult> {
    const resolvedModel = model ?? 'tinyllama:1b';
    const reflectFlag = options?.reflect === true;

    let result: ReActResult;

    if (options?.jsonMode && this.toolRegistry) {
      result = await this.executeJsonMode(systemPrompt, history, resolvedModel);
    } else {
      result = await this.executeTextMode(systemPrompt, history, resolvedModel);
    }

    // Aplica reflexão após a resposta final (ambos os modos)
    return this.applyReflection(result, resolvedModel, reflectFlag);
  }
}
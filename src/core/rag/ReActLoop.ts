/**
 * ReActLoop: Execução do ciclo Reasoning + Acting (SRP).
 *
 * Responsabilidade Única: Gerenciar o loop de interação ReAct:
 * 1. Concatena histórico de mensagens em um prompt único
 * 2. Envia para o provider e interpreta ações vs resposta final
 * 3. Se for JSON mode (--json), usa ToolRegistry + formato tool_call/final_response
 * 4. Se for modo texto, usa ACTION/FINAL_ANSWER + CommandExecutor
 * 5. Se streamMode=true, usa provider.streamChat() com callback onToken
 *
 * Compatível com IProvider.chat(request: ChatRequest): ChatResponse
 * e opcionalmente provider.streamChat(request: ChatRequest): AsyncIterable<string>
 * (prompt único, não array de mensagens — formata tudo inline)
 */

import type { IProvider } from '../../providers/types';
import type { CommandExecutor } from '../CommandExecutor';
import type { ToolRegistry } from '../ToolRegistry';
import type { Reflector, ReflectionResult, ReflectionError } from '../Reflector';
import { JsonValidator } from '../../validation/JsonValidator';
import { assessCompressionNeed, CompressionTrigger } from '../IContextCompressor';
import type { IContextCompressor } from '../IContextCompressor';
import { TokenEstimator } from '../TokenEstimator';

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
  /** Indica se a compressão de contexto foi aplicada no histórico */
  wasCompressed?: boolean;
  /** Taxa de compressão (0.0 a 1.0), presente apenas se wasCompressed for true */
  compressionRatio?: number;
}

/** Opções de streaming para o ReActLoop */
export interface StreamOptions {
  /** Se true, ativa streaming das respostas do modelo */
  enabled: boolean;
  /**
   * Callback chamado para cada token recebido durante o streaming.
   * Usado para efeito "máquina de escrever" no terminal.
   */
  onToken: (token: string) => void;
}

export class ReActLoop {
  private provider: IProvider;
  private executor?: CommandExecutor;
  private toolRegistry?: ToolRegistry;
  private reflector?: Reflector;
  private compressor?: IContextCompressor;
  private jsonValidator: JsonValidator;

  constructor(
    provider: IProvider,
    executor?: CommandExecutor,
    toolRegistry?: ToolRegistry,
    reflector?: Reflector,
    compressor?: IContextCompressor
  ) {
    this.provider = provider;
    this.executor = executor;
    this.toolRegistry = toolRegistry;
    this.reflector = reflector;
    this.compressor = compressor;
    this.jsonValidator = new JsonValidator();
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
   * Envia um prompt para o provider e retorna a resposta completa.
   * Se streamMode estiver ativo e o provider suportar streamChat,
   * faz streaming dos tokens + acumula o buffer para o parser.
   */
  private async sendPrompt(
    prompt: string,
    model: string,
    temperature: number,
    format?: 'json',
    streamOpts?: StreamOptions
  ): Promise<string> {
    // Modo streaming: usa streamChat + acumula buffer
    if (streamOpts?.enabled && this.provider.streamChat) {
      let buffer = '';
      for await (const token of this.provider.streamChat({
        model,
        prompt,
        temperature,
        format,
      })) {
        buffer += token;
        streamOpts.onToken(token);
      }
      return buffer;
    }

    // Modo normal: usa chat() padrão
    const response = await this.provider.chat({
      model,
      prompt,
      temperature,
      format,
    });
    return response.response.trim();
  }

  /**
   * Executa o loop ReAct no modo JSON (tool_call / final_response).
   * Usado quando --json está ativo. Usa ToolRegistry + detecção de loop.
   * Suporta streaming se streamOpts for fornecido.
   */
  private async executeJsonMode(
    systemPrompt: string,
    history: ReActMessage[],
    model: string,
    streamOpts?: StreamOptions
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

      const content = await this.sendPrompt(
        promptForThisIteration,
        model,
        0.2,
        'json',
        streamOpts // streaming para todas iterações; sendPrompt decide
      );

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

        // ── Prevenção de Context Overflow ──
        const contextLimit = TokenEstimator.getLimit(model);
        const resultSnippet = `\n\nResultado da ferramenta ${toolName}: ${toolResult}`;
        const estimatedNewTotal =
          TokenEstimator.estimate(accumulatedPrompt) +
          TokenEstimator.estimate(resultSnippet);
        const overflowThreshold = Math.floor(contextLimit * 0.8);

        if (estimatedNewTotal > overflowThreshold) {
          // Trunca o toolResult para caber no limite seguro
          const maxToolTokens = Math.max(
            50,
            overflowThreshold - TokenEstimator.estimate(accumulatedPrompt) - 100
          );
          const truncated = toolResult.slice(0, maxToolTokens * 4); // 4 chars ≈ 1 token
          const originalTokens = TokenEstimator.estimate(toolResult);
          toolResult =
            truncated +
            `\n\n⚠️ [CONTEXT OVERFLOW PREVENTION] O resultado original desta ferramenta ` +
            `tinha ~${originalTokens} tokens e foi truncado para caber no limite de contexto ` +
            `(~${contextLimit} tokens). Considere usar apenas as informações mais relevantes ` +
            `deste resultado.`;
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
   * Suporta streaming se streamOpts for fornecido.
   */
  private async executeTextMode(
    systemPrompt: string,
    history: ReActMessage[],
    model: string,
    streamOpts?: StreamOptions
  ): Promise<ReActResult> {
    let iteration = 0;
    let finalAnswer = '';
    let prompt = this.buildPrompt(systemPrompt, history);

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const content = await this.sendPrompt(
        prompt,
        model,
        0.3,
        undefined,
        streamOpts // streaming para todas iterações; sendPrompt decide
      );

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
   * @param options.stream Opções de streaming (se undefined, usa chat() normal)
   * @returns Resultado com resposta final e número de iterações
   */
  async execute(
    systemPrompt: string,
    history: ReActMessage[],
    model?: string,
    options?: { jsonMode?: boolean; reflect?: boolean; stream?: StreamOptions }
  ): Promise<ReActResult> {
    const resolvedModel = model ?? 'tinyllama:1b';
    const reflectFlag = options?.reflect === true;

    // ── Compressão de contexto (pré-buildPrompt) ──
    let currentHistory = history;
    let wasCompressed = false;
    let compressionRatio: number | undefined;

    if (this.compressor) {
      const estimatedTokens =
        TokenEstimator.estimateMessages(history) +
        TokenEstimator.estimate(systemPrompt);
      const contextLimit = TokenEstimator.getLimit(resolvedModel);
      const need = assessCompressionNeed(estimatedTokens, contextLimit);

      if (need !== CompressionTrigger.NONE) {
        const compressed = await this.compressor.compress(history, resolvedModel, systemPrompt);
        // Só adiciona workingMemory ao histórico se tiver conteúdo real
        // Isso evita mensagens [SYSTEM]: vazias no SessionStore (sessões fantasmas)
        if (compressed.workingMemory && compressed.workingMemory.trim().length > 0) {
          const workingMemoryMsg: ReActMessage = {
            role: 'system',
            content: compressed.workingMemory,
          };
          currentHistory = [workingMemoryMsg, ...compressed.keptMessages];
          wasCompressed = true;
          compressionRatio = compressed.compressionRatio;
          console.error(
            `[ReActLoop] Context compressed at ${need} trigger. ` +
            `Ratio: ${(compressed.compressionRatio * 100).toFixed(1)}%`,
          );
        } else {
          console.error(
            'Erro: Falha ao comprimir contexto. O histórico mais antigo foi truncado para economizar memória.'
          );
          currentHistory = compressed.keptMessages;
        }
      }
    }

    let result: ReActResult;

    if (options?.jsonMode && this.toolRegistry) {
      result = await this.executeJsonMode(systemPrompt, currentHistory, resolvedModel, options?.stream);
    } else {
      result = await this.executeTextMode(systemPrompt, currentHistory, resolvedModel, options?.stream);
    }

    // Aplica reflexão após a resposta final (ambos os modos)
    result = await this.applyReflection(result, resolvedModel, reflectFlag);

    return {
      ...result,
      wasCompressed,
      compressionRatio: wasCompressed ? compressionRatio : undefined,
    };
  }
}
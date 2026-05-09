/**
 * ReActStrategy — Estratégia de chat com ReAct Loop (Reasoning + Acting).
 *
 * Fluxo:
 *   1. buildSystemPrompt() → system prompt completo (com RAG se --rag)
 *   2. Delega para ReActLoop.execute() — loop de raciocínio com ferramentas
 *   3. Se --stream + streamChat disponível: faz streaming da resposta final
 *   4. Se --no-think: suprime o indicador "🤔 Pensando..."
 *
 * SRP: Responsabilidade única — gerenciar o pipeline ReAct.
 * OCP: Não precisa ser modificada para novos modos de chat.
 */

import type { ChatStrategy, ChatContext } from './ChatStrategy';
import { buildSystemPrompt } from './ChatStrategy';
import { ReActLoop, CommandExecutor } from '../../core';

export class ReActStrategy implements ChatStrategy {
  async execute(ctx: ChatContext): Promise<string> {
    const { app, prompt, streamMode, noThink } = ctx;
    const {
      provider,
      model,
      jsonMode,
      ragDir,
      commandExecutor,
      toolRegistry,
    } = app;

    // Constrói o system prompt completo (RAG + rules)
    const systemPrompt = await buildSystemPrompt(app, prompt, jsonMode, ragDir);

    // Cria o ReActLoop com dependências injetadas
    // - jsonMode = true: usa toolRegistry (JSON tool calls)
    // - jsonMode = false: usa commandExecutor (texto ACTION/FINAL_ANSWER)
    const reactLoop = new ReActLoop(
      provider,
      jsonMode ? undefined : commandExecutor,
      jsonMode ? toolRegistry : undefined
    );

    // Indicador visual de "pensamento" durante o ReAct
    if (streamMode && !noThink) {
      console.error(
        '🤔 Pensando... (iterações ReAct podem demorar alguns segundos)'
      );
    }

    // Executa o loop ReAct
    const result = await reactLoop.execute(
      systemPrompt,
      [], // histórico vazio (tudo já está no systemPrompt)
      model,
      { jsonMode }
    );

    // ── STREAMING PÓS-REACT ──
    // Se --stream está ativo e o provider suporta, faz streaming
    // da resposta final como efeito "máquina de escrever"
    if (streamMode && provider.streamChat) {
      const finalPrompt = `Responda de forma concisa e direta: ${result.finalAnswer}`;
      process.stdout.write(`[${model}] `);

      try {
        for await (const token of provider.streamChat({
          model,
          prompt: finalPrompt,
          temperature: 0.3,
        })) {
          process.stdout.write(token);
        }
        process.stdout.write('\n');
      } catch {
        // Fallback: mostra a resposta final sem streaming
        return `[${model}]\n${result.finalAnswer}`;
      }

      return ''; // Já escrevemos no stdout
    }

    // Modo normal (sem streaming): retorna a resposta formatada
    return `[${model}]\n${result.finalAnswer}`;
  }
}
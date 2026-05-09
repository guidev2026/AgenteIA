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
import type { ICritiqueProvider } from '../../providers/types';
import { ReActLoop, CommandExecutor, Reflector, ErrorJournal } from '../../core';

export class ReActStrategy implements ChatStrategy {
  async execute(ctx: ChatContext): Promise<string> {
    const { app, prompt, streamMode, noThink, reflectMode } = ctx;
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

    // Cria o Reflector (self-correction) se --reflect estiver ativo
    // O provider precisa implementar ICritiqueProvider (OllamaProvider sim)
    const critiqueProvider = provider as unknown as ICritiqueProvider;
    const reflector = reflectMode
      ? new Reflector(critiqueProvider, toolRegistry)
      : undefined;

    // ErrorJournal: persistência de erros de reflexão (TASK 6)
    // Usado internamente para registrar correções; exposto com --verbose
    const journal = new ErrorJournal();

    // Indicador visual de reflexão (vai para stderr para não poluir stdout)
    if (reflectMode && !noThink) {
      console.error('🪞 Reflector ativo — respostas serão revisadas automaticamente');
    }

    // Cria o ReActLoop com dependências injetadas
    // - jsonMode = true: usa toolRegistry (JSON tool calls)
    // - jsonMode = false: usa commandExecutor (texto ACTION/FINAL_ANSWER)
    const reactLoop = new ReActLoop(
      provider,
      jsonMode ? undefined : commandExecutor,
      jsonMode ? toolRegistry : undefined,
      reflector // injeta o Reflector (undefined se --reflect não ativo)
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
      { jsonMode, reflect: reflectMode }
    );

    // ── REGISTRO NO ERRORJOURNAL ──
    // Persiste erros de reflexão para auditoria (TASK 6)
    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        journal.addEntry({
          timestamp: new Date().toISOString(),
          model,
          type: err.type,
          description: err.description,
          correctionStatus: result.correctionStatus || 'stable',
          originalLength: prompt.length,
          correctedLength: result.finalAnswer.length,
        });
      }
    }

    // ── INDICADOR PÓS-REACT ──
    // Mostra iterações e status de correção no stderr (não polui stdout)
    if (!noThink) {
      const iterMsg = `✅ ReAct concluído em ${result.iterations} iteração${result.iterations > 1 ? 'ões' : ''}`;
      console.error(iterMsg);

      // Flag --verbose: estatísticas detalhadas do ErrorJournal (TASK 7)
      if (reflectMode && ctx.reflectMode) {
        const stats = journal.getStats();
        if (stats.total > 0) {
          console.error(`📊 Journal: ${stats.total} erro${stats.total > 1 ? 's' : ''} registrado${stats.total > 1 ? 's' : ''}`);
          if (stats.byType && Object.keys(stats.byType).length > 0) {
            console.error(`   Por tipo: ${Object.entries(stats.byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
          }
        }
      }

      // Propaga CorrectionStatus (TASK 4)
      if (result.correctionStatus) {
        const statusEmoji =
          result.correctionStatus === 'stable'
            ? '✅'
            : result.correctionStatus === 'suspicious'
              ? '⚠️'
              : '❌';
        const statusLabel =
          result.correctionStatus === 'stable'
            ? 'Resposta verificada — sem correções necessárias'
            : result.correctionStatus === 'suspicious'
              ? 'Resposta revisada — pequenos ajustes aplicados'
              : 'Resposta rejeitada — conteúdo considerado inseguro';
        console.error(`${statusEmoji} ${statusLabel}`);
      }

      if (result.errors && result.errors.length > 0) {
        for (const err of result.errors) {
          console.error(`  🪞 ${err.type}: ${err.description}`);
        }
      }
    }

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
    // Inclui badge de correção se aplicável
    const correctionBadge = result.correctionStatus && result.correctionStatus !== 'stable'
      ? ` [Refletido: ${result.correctionStatus}]`
      : '';
    return `[${model}]${correctionBadge}\n${result.finalAnswer}`;
  }
}
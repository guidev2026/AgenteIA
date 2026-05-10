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

/** Type guard: verifica se provider implementa ICritiqueProvider em runtime */
function isCritiqueProvider(p: unknown): p is ICritiqueProvider {
  return typeof (p as ICritiqueProvider).critique === 'function';
}
import { ReActLoop, CommandExecutor, Reflector, ErrorJournal, StatefulCompressor } from '../../core';

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

    // Obtém histórico da sessão ativa (vazio se não houver sessão)
    const history = app.getSessionHistory();

    // Constrói o system prompt completo (RAG + rules)
    // skipPromptSuffix=true quando há histórico, pois o prompt já está lá
    const systemPrompt = await buildSystemPrompt(
      app, prompt, jsonMode, ragDir,
      history.length > 0 // skipPromptSuffix
    );

    // Cria o Reflector (self-correction) se --reflect estiver ativo
    // Type guard verifica se provider implementa ICritiqueProvider em runtime
    const critiqueProvider = isCritiqueProvider(provider) ? provider : undefined;
    const reflector = reflectMode && critiqueProvider
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
    // StatefulCompressor: compressão de contexto para evitar estouro de tokens
    const compressor = new StatefulCompressor(provider);

    const reactLoop = new ReActLoop(
      provider,
      jsonMode ? undefined : commandExecutor,
      jsonMode ? toolRegistry : undefined,
      reflector, // injeta o Reflector (undefined se --reflect não ativo)
      compressor // injeta o compressor de contexto
    );

    // Indicador visual de "pensamento" durante o ReAct
    if (streamMode && !noThink) {
      console.error(
        '🤔 Pensando... (iterações ReAct podem demorar alguns segundos)'
      );
    }

    // Prepara opções de streaming (efeito "máquina de escrever")
    const streamOpts = streamMode
      ? {
          enabled: true,
          onToken: (token: string) => process.stdout.write(token),
        }
      : undefined;

    // Executa o loop ReAct com histórico da sessão multi-turn
    const result = await reactLoop.execute(
      systemPrompt,
      history, // histórico real da sessão (multi-turn)
      model,
      { jsonMode, reflect: reflectMode, stream: streamOpts }
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

    // ── RESPOSTA FINAL ──
    // Se --stream está ativo, o streaming já foi feito inline pelo ReActLoop
    // via callback onToken. A resposta final é retornada normalmente.
    // Inclui badge de correção se aplicável
    if (streamMode) {
      // Streaming já foi feito pelo ReActLoop durante a execução.
      // Só precisamos do \n final e do badge de correção no stderr
      if (result.correctionStatus && result.correctionStatus !== 'stable') {
        console.error(`[Refletido: ${result.correctionStatus}]`);
      }
      return ''; // Já escrevemos os tokens no stdout via onToken
    }

    // Modo normal (sem streaming): retorna a resposta formatada
    const correctionBadge = result.correctionStatus && result.correctionStatus !== 'stable'
      ? ` [Refletido: ${result.correctionStatus}]`
      : '';
    return `[${model}]${correctionBadge}\n${result.finalAnswer}`;
  }
}
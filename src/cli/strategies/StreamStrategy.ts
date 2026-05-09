/**
 * StreamStrategy — Estratégia de chat com streaming direto (efeito máquina de escrever).
 *
 * Fluxo:
 *   1. buildSystemPrompt() → system prompt completo (com RAG se --rag)
 *   2. Itera sobre provider.streamChat() escrevendo tokens no stdout
 *   3. Se streamChat não estiver disponível ou falhar, faz fallback para chat()
 *
 * SRP: Responsabilidade única — gerenciar o pipeline de streaming puro.
 * OCP: Não precisa ser modificada para novos modos de chat.
 */

import type { ChatStrategy, ChatContext } from './ChatStrategy';
import { buildSystemPrompt } from './ChatStrategy';

export class StreamStrategy implements ChatStrategy {
  async execute(ctx: ChatContext): Promise<string> {
    const { app, prompt, streamMode } = ctx;
    const { provider, model, jsonMode, ragDir } = app;

    // Validação: streaming direto não é compatível com --json
    if (jsonMode) {
      throw new Error(
        'StreamStrategy does not support jsonMode. Use ReActStrategy instead.'
      );
    }

    // Constrói o system prompt completo (RAG + tools)
    const systemPrompt = await buildSystemPrompt(app, prompt, jsonMode, ragDir);

    // Indica o modelo no início da resposta
    process.stdout.write(`[${model}] `);

    let fullResponse = '';

    // Se streamMode está desativado, ou streamChat não está disponível,
    // faz uma chamada normal e escreve de uma vez
    if (!streamMode || !provider.streamChat) {
      const resp = await provider.chat({
        model,
        prompt: systemPrompt,
        temperature: 0.3,
      });
      process.stdout.write(resp.response);
      process.stdout.write('\n');
      return ''; // Já escrevemos no stdout
    }

    // Streaming real (efeito máquina de escrever)
    try {
      for await (const token of provider.streamChat({
        model,
        prompt: systemPrompt,
        temperature: 0.3,
      })) {
        process.stdout.write(token);
        fullResponse += token;
      }
      process.stdout.write('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fallback para chat normal se streaming falhar
      console.error(`\n⚠️ Streaming error: ${msg}`);
      console.error('🔄 Fazendo fallback para modo normal...');
      const fallbackResp = await provider.chat({
        model,
        prompt: systemPrompt,
        temperature: 0.3,
      });
      return `[${model}]\n${fallbackResp.response}`;
    }

    return ''; // Já escrevemos no stdout
  }
}
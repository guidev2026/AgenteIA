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

    // Obtém o histórico multi-turn da sessão ativa
    const history = app.getSessionHistory();

    // Constrói o system prompt completo (RAG + tools)
    // skipPromptSuffix=true quando há histórico, pois o prompt já está lá
    const systemPrompt = await buildSystemPrompt(app, prompt, jsonMode, ragDir, history.length > 0);

    // Injeta histórico multi-turn no prompt, se houver
    // Formato: [USER]/[ASSISTANT] blocks para o modelo entender o contexto
    const historyBlock = history.length > 0
      ? '\n\n' + history.map(msg => {
          const label = msg.role === 'user' ? 'USER'
            : msg.role === 'assistant' ? 'ASSISTANT'
            : 'SYSTEM';
          return `[${label}]: ${msg.content}`;
        }).join('\n\n') + '\n\n'
      : '';

    // Se não houver histórico, usa systemPrompt direto (já tem o sufixo "Pergunta do usuário")
    // Se houver histórico, o buildSystemPrompt já pulou o sufixo, então precisamos
    // concatenar o historyBlock + a nova pergunta explicitamente
    const finalPrompt = history.length > 0
      ? systemPrompt + historyBlock + `Pergunta do usuário: ${prompt}`
      : systemPrompt;

    // Indica o modelo no início da resposta
    if (history.length > 0) {
      process.stdout.write(`[${model} (continuando sessão)] `);
    } else {
      process.stdout.write(`[${model}] `);
    }

    let fullResponse = '';

    // Se streamMode está desativado, ou streamChat não está disponível,
    // faz uma chamada normal e escreve de uma vez
    if (!streamMode || !provider.streamChat) {
      const resp = await provider.chat({
        model,
        prompt: finalPrompt,
        temperature: 0.3,
      });
      fullResponse = resp.response;
      process.stdout.write(fullResponse);
      process.stdout.write('\n');
      return fullResponse;
    }

    // Streaming real (efeito máquina de escrever)
    try {
      for await (const token of provider.streamChat({
        model,
        prompt: finalPrompt,
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
        prompt: finalPrompt,
        temperature: 0.3,
      });
      return `[${model}]\n${fallbackResp.response}`;
    }

    return fullResponse;
  }
}
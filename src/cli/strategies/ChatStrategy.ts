/**
 * ChatStrategy — Interface Strategy para modos de chat no CLI.
 *
 * SRP: Cada estratégia encapsula um pipeline de chat diferente:
 *   - StreamStrategy: streaming direto (sem ReAct)
 *   - ReActStrategy: ReAct loop (com ou sem streaming pós-resposta)
 *
 * OCP: Novos modos de chat são adicionados criando novas classes
 * que implementam ChatStrategy, sem modificar as existentes.
 */

import { AppContext, ReActLoop, RAGManager } from '../../core';
import type { IProvider } from '../../providers/types';

/** Contexto compartilhado entre todas as estratégias de chat */
export interface ChatContext {
  app: AppContext;
  prompt: string;
  streamMode: boolean;
  noThink: boolean;
  /** Se true, aplica Reflector (self-correction) pós-resposta */
  reflectMode: boolean;
}

/** Interface base para todas as estratégias de chat */
export interface ChatStrategy {
  /** Executa o pipeline de chat e retorna a resposta final formatada */
  execute(ctx: ChatContext): Promise<string>;
}

/**
 * Constrói o system prompt completo (tool definitions + RAG + JSON rules).
 *
 * Extraída para função pura (SRP) — testável isoladamente.
 *
 * @param app     AppContext (provider, toolRegistry, commandExecutor, etc.)
 * @param prompt  Prompt do usuário
 * @param jsonMode Se true, adiciona regras de resposta em formato JSON
 * @param ragDir  Diretório RAG opcional
 * @param fileReader  FileReader (injetado para RAGManager)
 * @param embedProvider Embed provider (injetado para RAGManager)
 * @returns System prompt completo
 */
export async function buildSystemPrompt(
  app: AppContext,
  prompt: string,
  jsonMode: boolean,
  ragDir?: string
): Promise<string> {
  const { toolRegistry, fileReader, embedProvider } = app;

  // ── RAG (Retrieval-Augmented Generation) ──
  let ragContext = '';
  if (ragDir) {
    try {
      const ragManager = RAGManager.create(fileReader, embedProvider);
      console.error(`📚 Indexando ${ragDir}...`);
      await ragManager.ensureIndex(ragDir);
      console.error(`🔍 Buscando contexto relevante para: "${prompt}"`);
      const matches = await ragManager.retrieve(prompt, ragDir);
      ragContext = ragManager.formatContext(matches);
      if (ragContext) {
        console.error(
          `✅ ${matches.length} trechos relevantes encontrados ` +
          `(total: ~${ragContext.length} chars)`
        );
      } else {
        console.error('ℹ️ Nenhum trecho relevante encontrado.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`⚠️ RAG error (continuando sem contexto): ${msg}`);
    }
  }

  // ── System Prompt ──
  const toolDefinitions = toolRegistry.getDefinitions();
  const toolNames = toolRegistry.getToolNames().join(', ');

  const systemPromptParts: string[] = [
    'Você é um assistente com acesso a ferramentas para ler arquivos e executar comandos.',
    `Seu diretório de trabalho atual é: ${process.cwd()}`,
    'Use caminhos relativos a este diretório OU caminhos absolutos.',
    '',
    `Ferramentas disponíveis: ${toolNames}`,
    '',
    'Definições das ferramentas (JSON Schema):',
    toolDefinitions,
  ];

  // Injeta contexto RAG no system prompt, se houver
  if (ragContext) {
    systemPromptParts.push(
      '',
      '─'.repeat(60),
      'DOCUMENTOS RELEVANTES PARA A PERGUNTA:',
      '',
      ragContext,
      '',
      '─'.repeat(60),
      '',
      'INSTRUÇÕES: Use os documentos acima como contexto para responder.',
      'Se a resposta estiver nos documentos, cite a fonte ([arquivo:linha]).',
      'Se não estiver nos documentos, use seu conhecimento geral.',
      ''
    );
  }

  // Se --json estiver ativo, usa formato tool_call / final_response
  if (jsonMode) {
    systemPromptParts.push(
      '',
      'REGRAS DE RESPOSTA (ESCRITAS EM JSON):',
      '1. Se precisar usar uma ferramenta, responda APENAS com:',
      '   {"tool_call": "<nome_da_ferramenta>", "args": {<parametros>}}',
      '2. Se já tiver a resposta final, responda APENAS com:',
      '   {"final_response": "<sua resposta completa>"}',
      '3. NUNCA responda com texto fora do JSON.',
      '4. NÃO invente informações — use as ferramentas para obter dados reais.',
      '5. Responda estritamente em formato JSON válido.'
    );
  }

  systemPromptParts.push('', `Pergunta do usuário: ${prompt}`);

  return systemPromptParts.join('\n');
}
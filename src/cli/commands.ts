/**
 * commands.ts — Roteador de comandos CLI com Injeção de Dependência (DIP).
 *
 * Fluxo:
 *   parseArgs (index.ts) → CliArgs → buildContext() → AppContext
 *   ↓
 *   runCommand() usa AppContext para acessar:
 *     - fileReader, commandExecutor, provider, toolRegistry
 *
 * DIP: Nenhum comando instancia diretamente FileReader, OllamaProvider, etc.
 *       Tudo é injetado via AppContext → ProviderFactory → interfaces.
 */

import { AppContext, RAGManager, FileReader } from '../core';
import type { IEmbedProvider } from '../providers/types';

/**
 * Estrutura que representa os argumentos parseados da linha de comando.
 *
 * Exemplo: `soberano chat "Explique SOLID" --model phi3:3b`
 *   command = "chat"
 *   args    = ["Explique SOLID"]
 *   flags   = { model: "phi3:3b" }
 */
export interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Cria o AppContext (container DI) a partir dos argumentos CLI parseados.
 *
 * DIP (Dependency Inversion Principle):
 * - AppContext gerencia a criação e injeção de TODAS as dependências.
 * - O comando não instancia diretamente providers, readers ou executors.
 * - Basta mudar o AppContextConfig para trocar de provider ou config.
 */
function buildContext(parsed: CliArgs): AppContext {
  const model = (parsed.flags.model as string) || 'llama3.2:1b';
  const ollamaHost = (parsed.flags.ollama as string) || 'localhost';
  const ollamaPort = Number(parsed.flags['ollama-port']) || 11434;
  const jsonMode = parsed.flags.json === true;
  const ragDir = parsed.flags.rag as string | undefined;

  return new AppContext({
    provider: {
      type: 'ollama',
      host: ollamaHost,
      port: ollamaPort,
    },
    model,
    jsonMode,
    ragDir,
  });
}

// Cache do contexto — construído uma vez por execução CLI
let ctx: AppContext | null = null;

function getContext(parsed: CliArgs): AppContext {
  if (!ctx) {
    ctx = buildContext(parsed);
  }
  return ctx;
}

/**
 * Função central de roteamento da CLI.
 *
 * Fluxo geral de dados:
 * ┌──────────┐    CliArgs     ┌──────────────────┐    comando     ┌─────────────────┐
 * │  index.ts│ ── parse ──▶  │  runCommand()     │ ── switch ──▶ │  FileReader /   │
 * │ (argv)   │              │                    │              │  CmdExecutor /  │
 * └──────────┘              └──────────────────┘              │  OllamaProvider │
 *                                    │                        └─────────────────┘
 *                                    │ string (output)
 *                                    ▼
 *                              ┌──────────┐
 *                              │  console │
 *                              └──────────┘
 *
 * @param parsed Argumentos parseados da linha de comando
 * @returns String formatada para exibição no terminal
 */
export async function runCommand(parsed: CliArgs): Promise<string> {
  const app = getContext(parsed);

  switch (parsed.command) {
    /**
     * Comando: read <file>
     * Exemplo: soberano read package.json
     */
    case 'read': {
      const filePath = parsed.args[0];
      if (!filePath) {
        throw new Error('Usage: soberano read <filepath>');
      }
      return app.fileReader.readFile(filePath);
    }

    /**
     * Comando: dir <path>
     * Exemplo: soberano dir src
     */
    case 'dir': {
      const dirPath = parsed.args[0] || '.';
      const entries = await app.fileReader.readDir(dirPath);
      return entries.join('\n');
    }

    /**
     * Comando: search <dir> <pattern>
     * Exemplo: soberano search src "export"
     */
    case 'search': {
      const dirPath = parsed.args[0];
      const pattern = parsed.args[1];
      if (!dirPath || !pattern) {
        throw new Error('Usage: soberano search <directory> <pattern>');
      }
      const results = await app.fileReader.searchFiles(dirPath, pattern);
      if (results.length === 0) return 'No matches found.';
      return results
        .map((r) => `${r.file}:${r.line}  ${r.content}`)
        .join('\n');
    }

    /**
     * Comando: exec <cmd>
     * Exemplo: soberano exec "ls -la"
     *
     * ⚠️ Segurança: o comando é dividido em executável + argumentos,
     * e o CommandExecutor usa spawn com shell:false, prevenindo injeção.
     */
    case 'exec': {
      const rawCmd = parsed.args.join(' ');
      if (!rawCmd) {
        throw new Error('Usage: soberano exec <command>');
      }
      const [cmd, ...cmdArgs] = rawCmd.split(' ');
      const result = await app.commandExecutor.execute(cmd, cmdArgs);
      return result.stdout || result.stderr || '(no output)';
    }

    /**
     * Comando: chat <prompt>
     *
     * Pipeline com ReAct Loop (Reasoning + Acting) quando --json está ativo.
     *
     * ┌──────────────┐
     * │ 1. args.join  │  prompt
     * └──────┬───────┘
     *        │
     * ┌──────▼───────────────────────────────────────────┐
     * │ 2. ToolRegistry (injetado via AppContext)          │
     * │    readFile, readDir, execute                      │
     * └──────┬───────────────────────────────────────────┘
     *        │
     * ┌──────▼───────────────────────────────────────────┐
     * │ 3. System Prompt + RAG context (se --rag)         │
     * └──────┬───────────────────────────────────────────┘
     *        │
     * ┌──────▼───────┐     ┌─────────────────────────┐
     * │ 4. ReAct     │────▶│ provider.chat(prompt)    │──▶ Ollama /api/generate
     * │    Loop      │     │ format: 'json' se --json │
     * │ (max 5 iter) │◀────│ response (JSON parseado) │
     * └──────┬───────┘     └─────────────────────────┘
     *        │
     *        │  parsed.tool_call?
     *        ├── SIM ──▶ toolRegistry.execute(name, args) → resultado → continua
     *        │
     *        │  parsed.final_response?
     *        └── SIM ──▶ quebra loop → exibe final_response
     *
     * Exemplo: soberano chat "Qual o conteúdo do package.json?" --json
     */
    case 'chat': {
      const prompt = parsed.args.join(' ');
      if (!prompt) {
        throw new Error('Usage: soberano chat <prompt>');
      }

      const {
        provider,
        toolRegistry,
        model,
        jsonMode,
        ragDir,
        fileReader,
        embedProvider,
      } = app;

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

      // Se --json estiver ativo, usa Grammar Restraint com formato JSON
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

      const systemPrompt = systemPromptParts.join('\n');

      // ── ReAct Loop ──
      const MAX_ITERATIONS = 5;
      let accumulatedPrompt = systemPrompt;
      let lastToolCall = '';

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Se for a última iteração, força o modelo a sintetizar resposta final
        const promptForThisIteration =
          i === MAX_ITERATIONS - 1
            ? accumulatedPrompt +
              '\n\nATENÇÃO: Esta é sua ÚLTIMA iteração. Você JÁ possui todos os ' +
              'dados necessários. Responda APENAS com ' +
              '{"final_response": "<sua resposta baseada nos dados coletados>"}. ' +
              'NÃO chame mais ferramentas.'
            : accumulatedPrompt;

        // Envia prompt ao modelo
        const response = await provider.chat({
          model,
          prompt: promptForThisIteration,
          temperature: 0.2,
          // Só ativa format: 'json' se --json foi passado
          ...(jsonMode ? { format: 'json' as const } : {}),
        });

        const content = response.response.trim();

        // Se não está em modo JSON, retorna a resposta crua
        if (!jsonMode) {
          return `[${response.model}]\n${content}`;
        }

        // Parse do JSON da resposta
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(content);
        } catch {
          // Fallback: se não for JSON, retorna cru
          return `[${response.model}]\n${content}`;
        }

        // Cenário A: tool call → executa e continua o loop
        if (parsed.tool_call && typeof parsed.tool_call === 'string') {
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
            toolResult = await toolRegistry.execute(toolName, toolArgs);
          } catch (err: unknown) {
            toolResult = err instanceof Error ? err.message : String(err);
          }

          accumulatedPrompt += `\n\nResultado da ferramenta ${toolName}: ${toolResult}`;
          continue;
        }

        // Cenário B: resposta final → exibe e encerra
        if (parsed.final_response && typeof parsed.final_response === 'string') {
          return `[${response.model}]\n${parsed.final_response}`;
        }

        // Cenário C: formato desconhecido → fallback
        return `[${response.model}]\n${content}`;
      }

      // Loop esgotado sem resposta final
      throw new Error(
        `ReAct loop exhausted (${MAX_ITERATIONS} iterations) without final_response. ` +
        `Last prompt length: ${accumulatedPrompt.length} chars.`
      );
    }

    /** Fallback: comando não reconhecido */
    default:
      throw new Error(
        `Unknown command: "${parsed.command}". ` +
        'Available: read, dir, search, exec, chat'
      );
  }
}
import { FileReader, CommandExecutor, ToolRegistry, RAGManager } from '../core';
import { OllamaProvider } from '../providers';

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

// Instâncias singleton — criadas uma única vez e compartilhadas em todas as chamadas
const fileReader = new FileReader();
const commandExecutor = new CommandExecutor();

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
 * Cada case do switch implementa um comando:
 *   - read:  lê arquivo via FileReader.readFile()
 *   - dir:   lista diretório via FileReader.readDir()
 *   - search: busca recursiva via FileReader.searchFiles()
 *   - exec:  executa comando shell via CommandExecutor.execute()
 *   - chat:  conversa com Ollama via OllamaProvider.chat()
 *
 * @param parsed Argumentos parseados da linha de comando
 * @returns String formatada para exibição no terminal
 */
export async function runCommand(parsed: CliArgs): Promise<string> {
  switch (parsed.command) {
    /**
     * Comando: read <file>
     *
     * Pipeline:
     *   args[0] → fileReader.readFile(path) → string do conteúdo → console
     *
     * Exemplo: soberano read package.json
     * Saída: conteúdo do package.json como string
     */
    case 'read': {
      const filePath = parsed.args[0];
      if (!filePath) {
        throw new Error('Usage: soberano read <filepath>');
      }
      return fileReader.readFile(filePath);
    }

    /**
     * Comando: dir <path>
     *
     * Pipeline:
     *   args[0] (ou '.') → fileReader.readDir(path) → string[] → join('\n') → console
     *
     * Exemplo: soberano dir src
     * Saída: "cli\ncore\nproviders"
     */
    case 'dir': {
      const dirPath = parsed.args[0] || '.';
      const entries = await fileReader.readDir(dirPath);
      return entries.join('\n');
    }

    /**
     * Comando: search <dir> <pattern>
     *
     * Pipeline:
     *   args[0] (dir), args[1] (pattern) → fileReader.searchFiles(dir, pattern)
     *   → SearchResult[] → mapeia para "arquivo:linha  conteúdo" → join('\n') → console
     *
     * Exemplo: soberano search src "export"
     * Saída: "src/cli/commands.ts:4  export interface CliArgs {"
     *
     * Se não encontrar nada, retorna "No matches found."
     */
    case 'search': {
      const dirPath = parsed.args[0];
      const pattern = parsed.args[1];
      if (!dirPath || !pattern) {
        throw new Error('Usage: soberano search <directory> <pattern>');
      }
      const results = await fileReader.searchFiles(dirPath, pattern);
      if (results.length === 0) return 'No matches found.';
      return results
        .map((r) => `${r.file}:${r.line}  ${r.content}`)
        .join('\n');
    }

    /**
     * Comando: exec <cmd>
     *
     * Pipeline:
     *   args.join(' ') → rawCmd → split(' ') → [cmd, ...args]
     *   → commandExecutor.execute(cmd, args) → CommandResult
     *   → stdout ou stderr ou "(no output)" → console
     *
     * Exemplo: soberano exec "ls -la"
     * Saída: saída do comando ls -la
     *
     * ⚠️ Segurança: o comando é dividido em executável + argumentos,
     * e o CommandExecutor usa spawn com shell:false, prevenindo injeção.
     * Nota: isso significa que pipes (|), redirecionamentos (>) e outros
     * recursos de shell não funcionam — apenas comandos diretos.
     */
    case 'exec': {
      const rawCmd = parsed.args.join(' ');
      if (!rawCmd) {
        throw new Error('Usage: soberano exec <command>');
      }
      // Separa o executável dos argumentos
      // Ex: "ls -la" → cmd="ls", cmdArgs=["-la"]
      const [cmd, ...cmdArgs] = rawCmd.split(' ');
      const result = await commandExecutor.execute(cmd, cmdArgs);
      // stdout tem prioridade; se vazio, mostra stderr; senão "(no output)"
      return result.stdout || result.stderr || '(no output)';
    }

    /**
     * Comando: chat <prompt>
     *
     * Pipeline com ReAct Loop (Reasoning + Acting):
     *
     * ┌──────────────┐
     * │ 1. args.join  │  prompt ← "Qual o conteúdo do package.json?"
     * └──────┬───────┘
     *        │
     * ┌──────▼───────────────────────────────────────────┐
     * │ 2. ToolRegistry.setup()                          │
     * │    Registra: readFile, readDir, execute           │
     * │    Gera JSON Schema com definições das tools      │
     * └──────┬───────────────────────────────────────────┘
     *        │
     * ┌──────▼───────────────────────────────────────────┐
     * │ 3. System Prompt                                 │
     * │    "Você é um assistente com acesso a tools...    │
     * │     Ferramentas disponíveis: [definitions]        │
     * │     Responda em JSON estrito com:                 │
     * │       tool_call + args   OU   final_response"     │
     * └──────┬───────────────────────────────────────────┘
     *        │
     * ┌──────▼───────┐     ┌─────────────────────────┐
     * │ 4. ReAct     │────▶│ provider.chat(prompt)    │──▶ Ollama /api/generate
     * │    Loop      │     │ format: 'json'           │
     * │ (max 5 iter) │◀────│ response (JSON parseado) │
     * └──────┬───────┘     └─────────────────────────┘
     *        │
     *        │  parsed.tool_call?
     *        ├── SIM ──▶ toolRegistry.execute(name, args)
     *        │           │
     *        │           ▼ resultado (string)
     *        │           │
     *        │     prompt += "\nResultado da ferramenta: " + resultado
     *        │           │
     *        │           └──▶ volta pro início do loop
     *        │
     *        │  parsed.final_response?
     *        └── SIM ──▶ quebra loop → exibe final_response
     *
     * Exemplo: soberano chat "Qual o conteúdo do package.json?" --json
     * Saída: "[llama3.2:1b]\nO arquivo package.json contém..."
     */
    case 'chat': {
      const prompt = parsed.args.join(' ');
      if (!prompt) {
        throw new Error('Usage: soberano chat <prompt>');
      }

      // Extrai configurações dos flags (ou usa defaults)
      const model = (parsed.flags.model as string) || 'llama3.2:1b';
      const ollamaHost = (parsed.flags.ollama as string) || 'localhost';
      const ollamaPort = Number(parsed.flags['ollama-port']) || 11434;
      // --json: ativa Grammar Restraint + ReAct Loop (tool use)
      const useJson = parsed.flags.json === true;
      // --rag <path>: ativa Retrieval-Augmented Generation
      const ragDir = parsed.flags.rag as string | undefined;

      const provider = new OllamaProvider(ollamaHost, ollamaPort);

      // ── RAG (Retrieval-Augmented Generation) ──
      // Se --rag foi passado, indexa o diretório e busca contexto
      let ragContext = '';
      if (ragDir) {
        try {
          const ragManager = new RAGManager(fileReader);
          ragManager.connectProvider(provider);
          console.error(`📚 Indexando ${ragDir}...`);
          await ragManager.ensureIndex(ragDir);
          console.error(`🔍 Buscando contexto relevante para: "${prompt}"`);
          const matches = await ragManager.retrieve(prompt, ragDir);
          ragContext = ragManager.formatContext(matches);
          if (ragContext) {
            console.error(`✅ ${matches.length} trechos relevantes encontrados (total: ~${ragContext.length} chars)`);
          } else {
            console.error('ℹ️ Nenhum trecho relevante encontrado.');
          }
        } catch (err: any) {
          console.error(`⚠️ RAG error (continuando sem contexto): ${err.message}`);
        }
      }

      // ── ToolRegistry: registra as ferramentas disponíveis ──
      const toolRegistry = new ToolRegistry();

      // Tool: readFile — lê conteúdo de um arquivo
      toolRegistry.register(
        'readFile',
        'Read the complete contents of a file from disk',
        {
          filePath: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
        },
        async (args) => {
          const content = await fileReader.readFile(args.filePath as string);
          return content;
        }
      );

      // Tool: readDir — lista entradas de um diretório
      toolRegistry.register(
        'readDir',
        'List all files and directories inside a directory',
        {
          dirPath: {
            type: 'string',
            description: 'Absolute or relative path to the directory',
          },
        },
        async (args) => {
          const entries = await fileReader.readDir(args.dirPath as string);
          return entries.join('\n');
        }
      );

      // Tool: execute — executa comando shell (seguro: shell:false)
      toolRegistry.register(
        'execute',
        'Execute a shell command safely (no shell injection). Returns stdout.',
        {
          command: {
            type: 'string',
            description: 'The executable name (e.g., ls, git, node)',
          },
          args: {
            type: 'array',
            description: 'Arguments as array of strings, e.g. ["-la"]',
          },
        },
        async (toolArgs) => {
          const cmd = toolArgs.command as string;
          // O LLM pode enviar args como array JS ou string. Normalizamos.
          const rawArgs = toolArgs.args;
          const cmdArgs: string[] = Array.isArray(rawArgs)
            ? rawArgs.map(String)
            : typeof rawArgs === 'string'
              ? rawArgs.split(' ')
              : [];
          const result = await commandExecutor.execute(cmd, cmdArgs);
          return result.stdout || result.stderr || '(no output)';
        }
      );

      // ── System Prompt com definições das tools ──
      const toolDefinitions = toolRegistry.getDefinitions();
      const toolNames = toolRegistry.getToolNames().join(', ');

      const systemPromptParts = [
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

      systemPromptParts.push(
        '',
        'REGRAS DE RESPOSTA (ESCRITAS EM JSON):',
        '1. Se precisar usar uma ferramenta, responda APENAS com:',
        '   {"tool_call": "<nome_da_ferramenta>", "args": {<parametros>}}',
        '2. Se já tiver a resposta final, responda APENAS com:',
        '   {"final_response": "<sua resposta completa>"}',
        '3. NUNCA responda com texto fora do JSON.',
        '4. NÃO invente informações — use as ferramentas para obter dados reais.',
        '',
        `Pergunta do usuário: ${prompt}`,
      );

      const systemPrompt = systemPromptParts.join('\n');

      // ── ReAct Loop ──
      const MAX_ITERATIONS = 5;
      let accumulatedPrompt = systemPrompt;
      let lastToolCall = '';  // Rastreia tool + args para detectar loops

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Se for a última iteração, força o modelo a sintetizar resposta final
        const promptForThisIteration =
          i === MAX_ITERATIONS - 1
            ? accumulatedPrompt + '\n\nATENÇÃO: Esta é sua ÚLTIMA iteração. Você JÁ possui todos os dados necessários. Responda APENAS com {"final_response": "<sua resposta baseada nos dados coletados>"}. NÃO chame mais ferramentas.'
            : accumulatedPrompt;

        // Envia prompt ao modelo com format: 'json' ativo
        const response = await provider.chat({
          model,
          prompt: promptForThisIteration,
          temperature: 0.2,
          format: 'json',
        });

        // Parse do JSON da resposta
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(response.response);
        } catch {
          // Fallback: se não for JSON, retorna cru (modo texto normal)
          return `[${response.model}]\n${response.response}`;
        }

        // Cenário A: tool call → executa e continua o loop
        if (parsed.tool_call && typeof parsed.tool_call === 'string') {
          const toolName = parsed.tool_call;
          const toolArgs = (parsed.args as Record<string, unknown>) || {};
          const callFingerprint = `${toolName}:${JSON.stringify(toolArgs)}`;

          // Detecta chamadas repetidas consecutivas (loop infinito)
          if (callFingerprint === lastToolCall && i < MAX_ITERATIONS - 1) {
            // Mesma tool + mesmos args: força resposta final na próxima
            accumulatedPrompt += `\n\nATENÇÃO: Você já chamou "${toolName}" com os mesmos argumentos. Use os dados já recebidos e responda com {"final_response": "<resposta>"}.`;
            lastToolCall = '';
            continue;
          }

          lastToolCall = callFingerprint;

          let toolResult: string;
          try {
            toolResult = await toolRegistry.execute(toolName, toolArgs);
          } catch (err: any) {
            toolResult = `Error: ${err.message}`;
          }

          // Alimenta o resultado de volta no prompt acumulado
          accumulatedPrompt += `\n\nResultado da ferramenta ${toolName}: ${toolResult}`;
          continue;
        }

        // Cenário B: resposta final → exibe e encerra
        if (parsed.final_response && typeof parsed.final_response === 'string') {
          return `[${response.model}]\n${parsed.final_response}`;
        }

        // Cenário C: formato desconhecido → fallback
        return `[${response.model}]\n${response.response}`;
      }

      // Loop esgotado sem resposta final
      throw new Error(
        `ReAct loop exhausted (${MAX_ITERATIONS} iterations) without final_response. ` +
        `Last tool result length: ${accumulatedPrompt.length} chars.`
      );
    }

    /** Fallback: comando não reconhecido */
    default:
      throw new Error(
        `Unknown command: "${parsed.command}". Available: read, dir, search, exec, chat`
      );
  }
}
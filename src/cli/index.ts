#!/usr/bin/env ts-node
import { runCommand, CliArgs } from './commands';

/**
 * Parser simples de argumentos de linha de comando.
 *
 * Fluxo de parsing:
 * ┌────────────┐                         ┌─────────────────┐
 * │ process    │  Ex: ['ts-node',        │  parseArgs()    │
 * │ .argv      │       'chat',           │                 │
 * │            │       'Explique SOLID', │  ┌─ positional ─▶ ['chat', 'Explique SOLID']
 * │            │       '--model',        │  │               
 * │            │       'phi3:3b']        │  └─ flags ──────▶ { model: 'phi3:3b' }
 * └────────────┘                         └──────┬──────────┘
 *                                               │
 *                                     ┌─────────▼──────────┐
 *                                     │ CliArgs {           │
 *                                     │   command: 'chat',  │
 *                                     │   args: ['Explique  │
 *                                     │          SOLID'],   │
 *                                     │   flags: {          │
 *                                     │     model:'phi3:3b' │
 *                                     │   }                 │
 *                                     │ }                   │
 *                                     └─────────────────────┘
 *
 * Convenção:
 *   - Tudo que começa com -- é flag
 *   - --flag valor → flags.flag = valor (consome o próximo token)
 *   - --flag (sem valor seguinte) → flags.flag = true (booleano)
 *   - Todo o resto é argumento posicional
 *   - O primeiro argumento posicional é o nome do comando
 *
 * @param raw Array cru de strings (process.argv)
 * @returns Objeto estruturado com comando, argumentos e flags
 */
function parseArgs(raw: string[]): CliArgs {
  // raw = ['ts-node', 'src/cli/index.ts', 'read', 'file.txt', '--model', 'tinyllama:1b']
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  // Descarta os dois primeiros (interpretador + script)
  // Ex: ['ts-node', 'src/cli/index.ts', ...] → sliced = ['read', 'file.txt', ...]
  const sliced = raw.slice(2);

  for (let i = 0; i < sliced.length; i++) {
    const token = sliced[i];
    if (token.startsWith('--')) {
      // Remove o prefixo '--' para obter o nome da flag
      const key = token.slice(2); // '--model' → 'model'
      const next = sliced[i + 1];
      // Se o próximo token existe e não é outra flag, é o valor desta flag
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++; // Consome o valor (avança um token extra)
      } else {
        // Flag booleana (ex: --verbose)
        flags[key] = true;
      }
    } else {
      // Argumento posicional (não começa com --)
      positional.push(token);
    }
  }

  // Primeiro posicional = comando; se ausente, default é 'help'
  const command = positional[0] ?? 'help';
  // Demais posicionais = argumentos do comando
  const args = positional.slice(1);

  return { command, args, flags };
}

/**
 * Entrypoint principal da CLI Soberano-Core.
 *
 * Fluxo completo da aplicação (do terminal ao output):
 *
 * Terminal
 *    │
 *    │ $ npm run dev -- chat "Explique SOLID" --model phi3:3b
 *    ▼
 * process.argv
 *    │
 *    ▼
 * parseArgs() ──▶ CliArgs { command, args, flags }
 *    │
 *    ├── command === 'help' ? ──▶ Exibe tela de ajuda e encerra
 *    │
 *    ▼
 * runCommand(parsed) ──▶ Promise<string>
 *    │
 *    ├── Sucesso ──▶ console.log(output)
 *    │
 *    └── Erro ──────▶ console.error() + process.exit(1)
 *
 * Tratamento de erros:
 *   - Erros de uso (args faltando) → mensagem + exit code 1
 *   - Erros de sistema (arquivo não encontrado) → mensagem + exit code 1
 *   - Erros de rede (Ollama offline) → mensagem + exit code 1
 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // Comando help: exibe documentação e encerra sem erro
  if (parsed.command === 'help') {
    console.log(`🛡️  Soberano-Core CLI — Agente IA com Function Calling / Tool Use

Usage: npm run dev -- <command> [args] [flags]

Commands:
  read  <file>                    Lê conteúdo de um arquivo
  dir   <path>                    Lista conteúdo de um diretório
  search <dir> <pattern>          Busca recursiva por padrão
  exec  <cmd>                     Executa comando shell
  chat  <prompt>                  Conversa com Ollama (ReAct Loop com tools)

Chat Flags:
  --model <name>                  Modelo Ollama (ex: tinyllama:1b, phi3:3b)
  --ollama <host>                 Host do Ollama (padrão: localhost)
  --ollama-port <port>            Porta do Ollama (padrão: 11434)
  --json                          Ativa ReAct Loop + JSON estrito (Function Calling)
  --rag <dir>                     Ativa RAG (Retrieval-Augmented Generation) com indexação do diretório

ReAct Loop (com --json):
  O modelo tem acesso às ferramentas: readFile, readDir, execute.
  Ele decide automaticamente quando usá-las para responder sua pergunta.
  Exemplo: npm run dev -- chat "Qual o conteúdo do package.json?" --json
  O agente vai: ler o arquivo → processar → responder com os dados reais.

  ⚠️  Segurança: execute usa shell:false (sem injeção de comandos).
  ⚠️  Limite: 5 iterações no loop ReAct (evita loops infinitos).

Retrieval-Augmented Generation (com --rag <dir>):
  Indexa arquivos .ts, .js, .json, .md, .txt do diretório informado usando
  all-minilm (embeddings 384-dim). Os chunks mais relevantes são injetados
  no contexto do modelo para responder com base na documentação real.

  Pipeline: chunking → embedding → cosine similarity → inject → respond

  Exemplo: npm run dev -- chat "Como instalar o projeto?" --rag .
  O modelo vai: indexar o diretório → buscar chunks relevantes →
  usar como contexto → responder com base na documentação.

  ⚠️  Requer all-minilm (instalado automaticamente com 'ollama pull').
  ⚠️  Cache em .soberano/index.json (reindexa apenas se houver mudanças).
  ⚠️  DOCUMENTACAO_PROJETO.md é sempre indexada como fonte prioritária.
`);
    return;
  }

  try {
    // Executa o comando e exibe o resultado
    const output = await runCommand(parsed);
    console.log(output);
  } catch (err: any) {
    // Qualquer erro é exibido no stderr e o processo termina com código 1
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// Executa a função principal
main();
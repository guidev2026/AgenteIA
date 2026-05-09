#!/usr/bin/env ts-node
import { runCommand, CliArgs } from './commands';

function parseArgs(raw: string[]): CliArgs {
  // raw = ['ts-node', 'src/cli/index.ts', 'read', 'file.txt', '--model', 'tinyllama:1b']
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  // Pula os dois primeiros (runtime + script) — mas o ts-node pode passar mais
  const sliced = raw.slice(2);

  for (let i = 0; i < sliced.length; i++) {
    const token = sliced[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = sliced[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++; // consome o valor
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }

  const command = positional[0] ?? 'help';
  const args = positional.slice(1);

  return { command, args, flags };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.command === 'help') {
    console.log(`🛡️  Soberano-Core CLI
Usage: npm run dev -- <command> [args] [flags]

Commands:
  read  <file>                    Lê conteúdo de um arquivo
  dir   <path>                    Lista conteúdo de um diretório
  search <dir> <pattern>          Busca recursiva por padrão
  exec  <cmd>                     Executa comando shell
  chat  <prompt>                  Conversa com Ollama (modelo padrão: phi3:3b)

Flags:
  --model <name>                  Modelo Ollama (ex: tinyllama:1b, phi3:3b)
  --ollama <host>                 Host do Ollama (padrão: localhost)
  --ollama-port <port>            Porta do Ollama (padrão: 11434)
`);
    return;
  }

  try {
    const output = await runCommand(parsed);
    console.log(output);
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
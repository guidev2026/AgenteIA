# 📄 Documentação do Projeto: Soberano-Core

## 📋 Visão Geral

**Soberano-Core** é um **Agente IA modular** construído em **TypeScript/Node.js** que integra um **Core** de utilitários (leitura de arquivos, execução de comandos), **Providers** (conexão com modelos de IA como Ollama) e uma **CLI** para interação via terminal.

- **Nome do pacote:** `soberano-core`
- **Versão:** `1.0.0`
- **Licença:** MIT
- **Linguagem:** TypeScript (target ES2020)
- **Gerenciador de pacotes:** npm
- **Dependências:** Nenhuma dependência externa em produção (apenas `@types/node`, `ts-node` e `typescript` como devDependencies)

---

## 🗂️ Estrutura do Projeto

```
AgenteIA/
├── package.json              # Configuração do npm + scripts
├── tsconfig.json             # Configuração do TypeScript
├── .gitignore                # Arquivos ignorados pelo Git
├── src/
│   ├── cli/
│   │   ├── index.ts          # Entrypoint da CLI + parser de argumentos
│   │   └── commands.ts       # Roteamento e implementação dos comandos
│   ├── core/
│   │   ├── index.ts          # Re-exports públicos do módulo core
│   │   ├── FileReader.ts     # Abstração do sistema de arquivos
│   │   └── CommandExecutor.ts # Execução segura de comandos shell
│   └── providers/
│       ├── index.ts          # Re-exports públicos do módulo providers
│       ├── types.ts          # Interfaces: ChatRequest, ChatResponse, IProvider
│       └── OllamaProvider.ts # Cliente HTTP para Ollama (modelos de IA locais)
```

---

## ⚙️ Módulo Core (`src/core/`)

### FileReader (`FileReader.ts`)

Abstração sobre o sistema de arquivos do Node.js (`fs/promises`). Toda operação é assíncrona (Promise-based).

**Métodos:**
| Método | Descrição |
|--------|-----------|
| `readFile(filePath)` | Lê conteúdo completo de um arquivo (UTF-8) |
| `readDir(dirPath)` | Lista entradas (arquivos/diretórios) de um diretório |
| `searchFiles(rootDir, pattern, maxResults?)` | Busca recursiva por padrão textual em arquivos; retorna `SearchResult[]` |

**Tipos exportados:**
- `SearchResult`: `{ file: string; line: number; content: string }`

---

### CommandExecutor (`CommandExecutor.ts`)

Camada segura sobre `child_process.spawn` do Node.js.

**Métodos:**
| Método | Descrição |
|--------|-----------|
| `execute(command, args?, options?)` | Executa comando shell com `shell: false` (previne injeção). Suporta timeout (padrão 60s) e cwd customizado |

**Tipos exportados:**
- `CommandResult`: `{ stdout: string; stderr: string; exitCode: number \| null; signal: NodeJS.Signals \| null }`

---

## 🔌 Módulo Providers (`src/providers/`)

Responsável pela comunicação com modelos de IA. Arquitetura baseada em interfaces para permitir múltiplos providers no futuro.

### Types (`types.ts`)

Define os contratos da API:

| Interface | Descrição |
|-----------|-----------|
| `ChatRequest` | `{ model, prompt, temperature?, max_tokens?, format? }` — requisição para o modelo. `format: 'json'` ativa Grammar Restraint |
| `ChatResponse` | `{ response, model, done }` — resposta do modelo |
| `IProvider` | `{ readonly name, chat(request): Promise<ChatResponse> }` — interface que todo provider deve implementar |

### OllamaProvider (`OllamaProvider.ts`)

Implementação concreta do `IProvider` para comunicação com instância local do **Ollama** via HTTP (sem dependências externas, usa apenas `node:http`).

**Funcionalidades:**
- Conexão com servidor Ollama em `host:port` configurável (padrão: `localhost:11434`)
- Envio de prompts via POST para `/api/generate` com suporte a `temperature`, `num_predict`, `stream: false` e `format: "json"`
- **Grammar Restraint nativo:** quando `format: 'json'` é ativado, o body inclui `"format": "json"` — o Ollama força o modelo a responder em JSON estrito
- **Validação de robustez:** se `format: 'json'` foi solicitado, a resposta é validada com `JSON.parse()` dentro de `try/catch`. Se o modelo alucinar JSON inválido, um erro claro é lançado protegendo o CLI
- Timeout de 300 segundos para respostas de modelos grandes
- Tratamento de erros de rede, parsing e status HTTP

---

## 🖥️ CLI (`src/cli/`)

Interface de linha de comando que orquestra Core + Providers.

### Entrypoint (`index.ts`)

- Faz o parsing de `process.argv`
- Separa argumentos posicionais de flags (`--flag valor`)
- Roteia para o comando apropriado via `runCommand()`
- Exibe output no console ou mensagem de erro com `process.exit(1)`

### Comandos (`commands.ts`)

| Comando | Sintaxe | Descrição |
|---------|---------|-----------|
| `help` | `soberano help` | Exibe tela de ajuda com todos os comandos disponíveis |
| `read` | `soberano read <file>` | Lê conteúdo de um arquivo |
| `dir` | `soberano dir <path>` | Lista conteúdo de um diretório |
| `search` | `soberano search <dir> <pattern>` | Busca recursiva por padrão textual |
| `exec` | `soberano exec <cmd>` | Executa comando shell (com `shell: false` por segurança) |
| `chat` | `soberano chat <prompt> [--model] [--ollama] [--ollama-port] [--json]` | Envia prompt para modelo Ollama e exibe resposta |

**Flags do comando `chat`:**
- `--model <name>` — Modelo Ollama (padrão: `llama3.2:1b`)
- `--ollama <host>` — Host do servidor Ollama (padrão: `localhost`)
- `--ollama-port <port>` — Porta do Ollama (padrão: `11434`)
- `--json` — Ativa Grammar Restraint: força resposta em JSON estrito e injeta system prompt `"Responda estritamente em formato JSON válido."`

---

## 🚀 Scripts npm

| Script | Comando | Descrição |
|--------|---------|-----------|
| `build` | `tsc` | Compila TypeScript para JS na pasta `dist/` |
| `dev` | `ts-node src/cli/index.ts` | Executa em modo desenvolvimento |
| `start` | `node dist/cli/index.js` | Executa versão compilada |

**Exemplos de uso:**
```bash
npm run dev -- chat "Explique o que é SOLID" --model phi3:3b
npm run dev -- chat "Give me JSON with name and age" --json
npm run dev -- read package.json
npm run dev -- search src "export"
npm run dev -- exec "ls -la"
```

---

## 🏗️ Arquitetura Geral

```
Terminal (usuário)
    │
    ▼
┌──────────────────────────┐
│       CLI (index.ts)      │  ← parseArgs()
│   parser de argumentos    │
└────────┬─────────────────┘
         │ CliArgs { command, args, flags }
         ▼
┌──────────────────────────┐
│    commands.ts           │  ← runCommand()
│  roteador de comandos    │
└───┬───────┬───────┬─────┘
    │       │       │
    ▼       ▼       ▼
┌────────┐┌────────┐┌──────────────┐
│Core    ││Core    ││ providers/   │
│FileReader││Command ││ OllamaProvider│
│(FS ops)││Executor││ (HTTP Ollama)│
└────────┘└────────┘└──────────────┘
```

---

## 🔒 Segurança

- `CommandExecutor` usa `spawn` com `shell: false` — previne injeção de comandos shell
- `FileReader` silencia erros em diretórios/arquivos sem permissão durante buscas recursivas
- Sem dependências externas em produção (apenas módulos nativos do Node.js)

---

## 📌 Status Atual

✅ Projeto estruturalmente completo com:
- Core funcional (leitura de arquivos, busca textual, execução de comandos)
- Integração com Ollama via HTTP
- CLI funcional com 6 comandos (read, dir, search, exec, chat, help)
- Grammar Restraint / Structured Outputs — força modelos a responderem em JSON estrito via `--json`
- Validação de robustez com `JSON.parse()` + `try/catch` para prevenir alucinações
- Injeção automática de system prompt quando `--json` é usado
- Arquitetura modular e extensível (interface `IProvider` permite novos providers)
- Zero dependências externas em produção (apenas `node:http`, `node:fs/promises`, `node:child_process`)
- TypeScript configurado com strict mode

📝 **Possíveis próximos passos (não implementados):**
- Adicionar streaming de respostas do Ollama (SSE)
- Implementar novos providers (OpenAI, Anthropic, etc.)
- Adicionar testes unitários
- Adicionar suporte a sessões/conversa com histórico
- Suporte a tools/funções para o agente executar ações

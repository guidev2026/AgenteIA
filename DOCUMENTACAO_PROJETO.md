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
├── package.json                # Configuração do npm + scripts
├── tsconfig.json               # Configuração do TypeScript
├── .gitignore                  # Arquivos ignorados pelo Git
├── DOCUMENTACAO_PROJETO.md     # Esta documentação
├── src/
│   ├── cli/
│   │   ├── index.ts            # Entrypoint da CLI + parser de argumentos
│   │   └── commands.ts         # Roteamento e implementação dos comandos (DIP)
│   ├── core/
│   │   ├── index.ts            # Re-exports públicos do módulo core
│   │   ├── FileReader.ts       # Abstração do sistema de arquivos
│   │   ├── CommandExecutor.ts  # Execução segura de comandos shell
│   │   ├── ToolRegistry.ts     # Registro de tools com JSON Schema + handlers
│   │   ├── AppContext.ts       # Container DI com todas as dependências (DIP)
│   │   ├── ProviderFactory.ts  # Factory para criar providers (OCP)
│   │   └── rag/
│   │       ├── index.ts        # Re-exports do módulo RAG
│   │       ├── Chunker.ts      # Divisão de texto em chunks (SRP)
│   │       ├── Embedder.ts     # Geração de embeddings (SRP)
│   │       ├── VectorStore.ts  # Cache de embeddings em disco (SRP)
│   │       ├── Retriever.ts    # Busca por similaridade (SRP)
│   │       ├── RAGManager.ts   # Orquestrador do pipeline RAG
│   │       ├── PromptBuilder.ts# Montagem de prompt com contexto (SRP)
│   │       └── ReActLoop.ts    # Loop Reasoning + Acting (Strategy)
│   ├── providers/
│   │   ├── index.ts            # Re-exports públicos do módulo providers
│   │   ├── types.ts            # Interfaces: IProvider, IEmbedProvider, ChatRequest, etc.
│   │   └── OllamaProvider.ts   # Cliente HTTP para Ollama (chat + embeddings)
│   └── validation/
│       └── JsonValidator.ts    # Validador JSON puro (SRP, zero dependências)
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

### RAGManager (`RAGManager.ts`)

Gerencia o pipeline de Retrieval-Augmented Generation: chunking de arquivos, geração de embeddings, busca por similaridade de cosseno e cache em disco. Zero dependências externas (usa apenas `node:fs/promises`, `node:path`, `node:crypto`).

**Métodos:**
| Método | Descrição |
|--------|-----------|
| `ensureIndex(dir)` | Indexa diretório (chunks → embeddings → cache). Só reindexa se houver mudanças |
| `retrieve(query, dir)` | Busca semântica: top 5 chunks por cosine similarity |
| `formatContext(matches)` | Formata chunks como `[arquivo:linha]` para injeção no prompt |
| `connectProvider(provider)` | Conecta ao OllamaProvider para gerar embeddings via all-minilm |

**Tipos exportados:**
- `ChunkEntry`: `{ text: string; file: string; line: number; embedding: number[] }`
- `SearchMatch`: `{ file: string; line: number; content: string; score: number }`

---

## 🔌 Módulo Providers (`src/providers/`)

Responsável pela comunicação com modelos de IA. Arquitetura baseada em interfaces para permitir múltiplos providers no futuro.

### Types (`types.ts`)

Define os contratos da API:

| Interface | Descrição |
|-----------|-----------|
| `ChatRequest` | `{ model, prompt, temperature?, max_tokens?, format? }` — requisição para o modelo. `format: 'json'` ativa Grammar Restraint |
| `ChatResponse` | `{ response, model, done }` — resposta do modelo |
| `EmbedRequest` | `{ model, prompt }` — requisição de embedding para o Ollama |
| `EmbedResponse` | `{ embedding: number[] }` — resposta de embedding (vetor 384-dim do all-minilm) |
| `IProvider` | `{ readonly name, chat(request): Promise<ChatResponse>, embed(request): Promise<EmbedResponse> }` — interface que todo provider deve implementar |

### OllamaProvider (`OllamaProvider.ts`)

Implementação concreta do `IProvider` para comunicação com instância local do **Ollama** via HTTP (sem dependências externas, usa apenas `node:http`).

**Funcionalidades:**
- Conexão com servidor Ollama em `host:port` configurável (padrão: `localhost:11434`)
- Envio de prompts via POST para `/api/generate` com suporte a `temperature`, `num_predict`, `stream: false` e `format: "json"`
- **Grammar Restraint nativo:** quando `format: 'json'` é ativado, o body inclui `"format": "json"` — o Ollama força o modelo a responder em JSON estrito
- **Embeddings:** método `embed(request)` que envia POST para `/api/embeddings` com `keep_alive: "5m"` para reutilizar sessão do all-minilm
- **Vetores 384-dim:** retorna `number[]` (float32) padrão do modelo all-minilm
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
| `chat` | `soberano chat <prompt> [--model] [--ollama] [--ollama-port] [--json] [--rag <dir>]` | Envia prompt para modelo Ollama com suporte a RAG |

**Flags do comando `chat`:**
- `--model <name>` — Modelo Ollama (padrão: `llama3.2:1b`)
- `--ollama <host>` — Host do servidor Ollama (padrão: `localhost`)
- `--ollama-port <port>` — Porta do Ollama (padrão: `11434`)
- `--json` — Ativa Grammar Restraint: força resposta em JSON estrito e injeta system prompt `"Responda estritamente em formato JSON válido."`
- `--rag <dir>` — Ativa RAG: indexa diretório e injeta chunks relevantes no contexto

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
npm run dev -- chat "Como instalar o projeto?" --rag .
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
    │
    ▼
┌──────────────┐
│  RAGManager  │  ← embeddings + busca semântica
│(all-minilm)  │
└──────────────┘
```

---

## 🔒 Segurança

- `CommandExecutor` usa `spawn` com `shell: false` — previne injeção de comandos shell
- `FileReader` silencia erros em diretórios/arquivos sem permissão durante buscas recursivas
- `RAGManager` só reindexa se houver mudanças (hash dos arquivos) — evita I/O desnecessário
- Sem dependências externas em produção (apenas módulos nativos do Node.js)

---

## 🔧 Tópico 11 — Function Calling / Tool Use (ReAct Loop)

### Arquitetura do ToolRegistry

O `ToolRegistry` (`src/core/ToolRegistry.ts`) implementa um registro de ferramentas (tools) no formato JSON Schema, compatível com o padrão OpenAI/Function Calling.

```
┌─────────────────────────────────────────────────────────┐
│                   ToolRegistry                          │
│  tools: Map<                                            │
│    string,                // nome da tool               │
│    { definition, handler }                              │
│  >                                                      │
│                                                         │
│  + register(name, description, paramsSchema, handler)   │
│  + getDefinitions(): string   // JSON Schema p/ prompt  │
│  + execute(name, args): Promise    // chama handler     │
│  + hasTool(name): boolean                               │
└─────────────────────────────────────────────────────────┘
```

**Tools registradas:**
| Tool | Descrição | Parâmetros |
|------|-----------|------------|
| `readFile` | Lê conteúdo completo de um arquivo | `filePath: string` |
| `readDir` | Lista entradas de um diretório | `dirPath: string` |
| `execute` | Executa comando shell (seguro: `shell:false`) | `command: string`, `args: string[]` |

### ReAct Loop (Reasoning + Acting)

O comando `chat` com `--json` implementa o padrão ReAct:

```
Usuário: "Qual o conteúdo do package.json?" --json

1. System Prompt → envia definições JSON Schema das tools +
   regras de resposta: tool_call + args OU final_response
   
2. Modelo responde:
   {"tool_call": "readFile", "args": {"filePath": "package.json"}}

3. ToolRegistry.execute("readFile", {filePath: "package.json"})
   → lê o arquivo real → resultado alimentado de volta no prompt

4. Modelo responde:
   {"final_response": "O package.json contém..."}
   
5. CLI exibe a resposta final
```

**Mecanismos de segurança e robustez:**
| Mecanismo | Descrição |
|-----------|-----------|
| `ToolRegistry.execute()` | Verifica se a tool existe antes de executar — nunca expõe handlers dinamicamente |
| `CommandExecutor.execute()` | Usa `spawn` com `shell: false` — previne injeção de comandos |
| Limite de iterações | Máximo 5 iterações no ReAct Loop (evita loops infinitos) |
| Detecção de loop | Rastreia chamadas repetidas da mesma tool com mesmos args; força `final_response` |
| Última iteração forçada | Na 5ª iteração, injeta instrução para o modelo sintetizar resposta final |
| `JSON.parse()` + `try/catch` | Toda resposta do modelo é validada como JSON antes de ser processada |

### Exemplo de uso

```bash
# Modo ReAct: o agente decide quais ferramentas usar
npm run dev -- chat "Qual o conteúdo do package.json?" --json --model llama3.2:1b

# Modo texto normal (sem ferramentas)
npm run dev -- chat "Explique o que é SOLID" --model llama3.2:3b
```

### Limitações conhecidas

- **Modelos 1B–3B** podem não seguir o schema JSON perfeitamente. O sistema inclui fallbacks (resposta crua se JSON inválido, força de resposta final na última iteração).
- **Modelos 7B+ são recomendados** para uso consistente do ReAct Loop em produção.
- O formato `final_response` pode conter JSON parcial/alucinado em modelos muito pequenos.

---

## 🔧 Tópico 12 — Retrieval-Augmented Generation (RAG)

### Visão Geral

O RAG (Retrieval-Augmented Generation) permite que o modelo responda perguntas com base no conteúdo real de arquivos do projeto. O pipeline funciona em 3 etapas:

1. **Indexação:** arquivos `.ts`, `.js`, `.json`, `.md`, `.txt` são divididos em chunks de 512 caracteres (com overlap de 64) e cada chunk é convertido em um vetor de embedding 384-dim usando o modelo `all-minilm`
2. **Busca semântica:** a pergunta do usuário é convertida no mesmo espaço vetorial. Usamos **cosine similarity** para encontrar os 5 chunks mais relevantes
3. **Injeção no contexto:** os chunks são formatados como `[arquivo:linha]` e injetados no system prompt do modelo, que responde com base nesse contexto

### Arquivo: `src/core/RAGManager.ts`

```
┌──────────────────────────────────────────────────────────────────┐
│                       RAGManager                                  │
│                                                                   │
│  + ensureIndex(dir): Promise<void>                                │
│    └── percorre arquivos → chunk (512 chars, overlap 64)          │
│    └── gera hash dos arquivos → detecta mudanças                  │
│    └── só reindexa se houver modificação                          │
│    └── salva cache em .soberano/index.json                        │
│                                                                   │
│  + retrieve(query, dir): Promise<SearchMatch[]>                   │
│    └── gera embedding da query (all-minilm)                       │
│    └── calcula cosine similarity contra todos os chunks           │
│    └── retorna top 5 com score + arquivo + linha + conteúdo       │
│                                                                   │
│  + formatContext(matches): string                                 │
│    └── formata como: "--- [arquivo:linha] ---\nconteúdo"          │
│                                                                   │
│  Interface SearchMatch:                                           │
│    { file, line, content, score: number }                         │
│                                                                   │
│  Interface ChunkEntry (cache):                                    │
│    { text, file, line, embedding: number[] }                      │
└──────────────────────────────────────────────────────────────────┘
```

### Pipeline RAG no comando `chat`

```
Usuário: "Como instalar o projeto?" --rag .

1. RAGManager.ensureIndex(".")
   └── indexa .ts, .js, .json, .md, .txt → chunks → embeddings → cache

2. RAGManager.retrieve("Como instalar o projeto?", ".")
   └── embedding da query → cosine similarity → top 5 chunks

3. RAGManager.formatContext(top5)
   └── "[DOCUMENTACAO_PROJETO.md:138] npm run dev -- chat..."

4. System Prompt injetado:
   ────────────────────────────────────────────
   DOCUMENTOS RELEVANTES PARA A PERGUNTA:
   [DOCUMENTACAO_PROJETO.md:138] npm run dev -- chat...
   ...
   ────────────────────────────────────────────

5. Modelo responde com base nos documentos reais
```

### Mecanismos de robustez

| Mecanismo | Descrição |
|-----------|-----------|
| Cache inteligente | `.soberano/index.json` armazena embeddings + hash dos arquivos. Reindexa apenas se houver mudanças |
| DOCUMENTACAO_PROJETO.md prioritário | O arquivo de documentação é indexado primeiro, garantindo que esteja sempre presente |
| Fallback silencioso | Se o embedding falhar ou diretório não existir, o chat continua sem contexto RAG |
| Zero dependências | Embeddings usam `node:http` + `JSON.parse` — sem bibliotecas externas |
| Chunking com overlap | 512 chars com 64 de overlap evita perda de contexto entre chunks |

### Exemplo de uso

```bash
# Indexa o diretório atual e responde com base na documentação real
npm run dev -- chat "Como instalar o projeto?" --rag .

# Indexa um diretório específico
npm run dev -- chat "Qual a estrutura do código?" --rag ./src

# Funciona com ou sem --json (modo RAG puro ou ReAct + RAG)
npm run dev -- chat "Explique a arquitetura" --rag . --json
```

### Requisitos

- Modelo **all-minilm** instalado no Ollama (baixado automaticamente no primeiro uso)
- Modelo de chat (ex: `llama3.2:1b`, `phi3:3b`) para gerar respostas
- Diretório com arquivos de texto `.ts`, `.js`, `.json`, `.md`, `.txt`

---

## 🧪 Testes Unitários

A suíte de testes usa **Vitest** (v4.1.5) e está organizada em `tests/unit/`, espelhando a estrutura do `src/`.

### Cobertura atual

| Módulo | Arquivo | Testes | O que cobre |
|--------|---------|--------|-------------|
| **Core** | `tests/unit/core/ToolRegistry.test.ts` | 9 | Registro de tools, execução com/sem parâmetros, validação de existência |
| **Core** | `tests/unit/core/CommandExecutor.test.ts` | 3 | Execução de comandos, captura stderr, erro de spawn |
| **Providers** | `tests/unit/providers/OllamaProvider.test.ts` | 7 | Chat com parâmetros, format=json (Grammar Restraint), erro HTTP, embed |
| **RAG** | `tests/unit/rag/Retriever.test.ts` | 13 | Cosine similarity, rankeamento, ordenação, busca vazia |
| **RAG** | `tests/unit/rag/ReActLoop.test.ts` | 14 | **Text Mode:** ACTION/FINAL_ANSWER, limite 5 iterações, erro em ACTION, build de prompt, modelo padrão. **JSON Mode:** final_response direta, tool_call → ferramenta → final_response, detecção de loop repetido, fallback text mode, resposta não-JSON, formato desconhecido, erro em ferramenta, esgotamento de iterações |
| **RAG** | `tests/unit/rag/Chunker.test.ts` | 8 | Chunking por parágrafo, sentença, overlap, limite de chunks |
| **Validation** | `tests/unit/validation/JsonValidator.test.ts` | 13 | validate(), tryValidate(), ValidationError |

**Total: 67 testes, todos passando.**

### Estratégia de Mocks (zero I/O real)

| Módulo mockado | Técnica | Classe testada |
|----------------|---------|----------------|
| `node:http` | `vi.mock('node:http', ...)` — intercepta `http.request()` | `OllamaProvider` |
| `node:child_process` | `vi.mock('node:child_process', ...)` — intercepta `cp.spawn()` | `CommandExecutor` |
| `IProvider` + `CommandExecutor` + `ToolRegistry` | Mock de interface/classes reais injetadas no construtor com `vi.fn()` | `ReActLoop` |

Nenhum teste faz chamadas reais ao Ollama, executa comandos shell reais ou acessa o sistema de arquivos além do necessário para importar módulos TypeScript. **Consumo de hardware: ~50MB RAM, 0% CPU para modelos.**

### Scripts npm

| Script | Comando | Descrição |
|--------|---------|-----------|
| `test` | `vitest run` | Executa todos os testes uma vez |
| `test:watch` | `vitest` | Executa testes em modo watch (desenvolvimento) |

### Executando

```bash
npm test              # Executa todos os testes
npx vitest run        # Equivalente
npx vitest run tests/unit/providers/  # Apenas providers
npx vitest            # Modo watch (recarrega automático)
```

---

## 📌 Status Atual

✅ Projeto estruturalmente completo com:
- Core funcional (leitura de arquivos, busca textual, execução de comandos)
- **ToolRegistry** com 3 tools registradas (readFile, readDir, execute)
- **ReAct Loop** — agente decide automaticamente quando usar ferramentas
- **RAG (Retrieval-Augmented Generation)** — indexação de diretórios com embeddings + busca semântica + injeção de contexto
- Integração com Ollama via HTTP (chat + embeddings)
- CLI funcional com 6 comandos (read, dir, search, exec, chat, help)
- Grammar Restraint / Structured Outputs — força modelos a responderem em JSON estrito via `--json`
- Validação de robustez com `JSON.parse()` + `try/catch` para prevenir alucinações
- Detecção de loops com força de resposta final na última iteração
- Injeção automática de system prompt com definições JSON Schema das tools
- Arquitetura modular e extensível (interface `IProvider` permite novos providers)
- Zero dependências externas em produção (apenas `node:http`, `node:fs/promises`, `node:child_process`)
- TypeScript configurado com strict mode
- ✅ **SOLID implementado** — SRP (classes coesas), OCP (ProviderFactory), LSP (IProvider), ISP (interfaces enxutas), DIP (AppContext + injeção de dependências)
- ✅ **67 testes unitários** passando com Vitest (7 arquivos: ToolRegistry, CommandExecutor, OllamaProvider, Retriever, ReActLoop, Chunker, JsonValidator)

📝 **Possíveis próximos passos (não implementados):**
- Adicionar streaming de respostas do Ollama (SSE)
- Implementar novos providers (OpenAI, Anthropic, etc.)
- Adicionar suporte a sessões/conversa com histórico (multi-turn)
- Expandir ToolRegistry com mais ferramentas (writeFile, searchFiles, etc.)
- Melhorar chunking com overlap adaptativo por estrutura (AST-aware)
- Adicionar reranking multi-stage para melhorar precisão da busca
- Suporte a PDF, DOCX e outros formatos no RAG

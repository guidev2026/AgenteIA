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
├── tests/
│   ├── unit/                   # Testes unitários (mockados, zero I/O real)
│   └── integration/            # Testes de integração (filesystem real)
│       └── editing-pipeline.test.ts  # Pipeline ASTEditor + SearchReplaceEditor
├── src/
│   ├── cli/
│   │   ├── index.ts            # Entrypoint da CLI + parser de argumentos
│   │   ├── commands.ts         # Roteamento e implementação dos comandos (DIP)
│   │   └── strategies/         # Estratégias de chat (Strategy Pattern)
│   │       ├── index.ts        # Re-exports
│   │       ├── ChatStrategy.ts # Interface + buildSystemPrompt() + editing workflow
│   │       ├── StreamStrategy.ts # Streaming direto (SSE)
│   │       └── ReActStrategy.ts  # ReAct loop com ou sem streaming
│   ├── core/
│   │   ├── index.ts            # Re-exports públicos do módulo core
│   │   ├── FileReader.ts       # Abstração do sistema de arquivos
│   │   ├── CommandExecutor.ts  # Execução segura de comandos shell
│   │   ├── ToolRegistry.ts     # Registro de tools com JSON Schema + handlers
│   │   ├── AppContext.ts       # Container DI com todas as dependências (DIP)
│   │   ├── ProviderFactory.ts  # Factory para criar providers (OCP)
│   │   ├── SessionStore.ts     # Persistência de conversas em disco (JSON)
│   │   ├── SessionManager.ts   # Orquestração da sessão ativa + histórico
│   │   ├── TokenEstimator.ts   # Estimador de tokens para compressão de contexto
│   │   ├── IContextCompressor.ts # Interface do compressor de contexto (ISP)
│   │   ├── StatefulCompressor.ts # Compressor com fallback + logging (SRP)
│   │   ├── astUtils.ts         # Utilitários de AST (parsing + análise)
│   │   ├── ASTEditor.ts        # Edição de código-fonte via AST (substituição por símbolo)
│   │   ├── SearchReplaceEditor.ts # Edição de arquivos por busca/substituição de blocos
│   │   └── rag/
│   │       ├── index.ts        # Re-exports do módulo RAG
│   │       ├── IChunker.ts     # Interface do Chunker (ISP/DIP)
│   │       ├── Chunker.ts      # Divisão de texto em chunks (SRP, implementa IChunker)
│   │       ├── IASTParser.ts   # Interface para parseadores AST (ISP)
│   │       ├── TypescriptASTAdapter.ts # Parseador AST concreto (Adapter Pattern)
│   │       ├── ASTChunkerService.ts # Chunking AST-aware com fallback (Decorator)
│   │       ├── Embedder.ts     # Geração de embeddings (SRP)
│   │       ├── VectorStore.ts  # Cache de embeddings em disco (SRP)
│   │       ├── Retriever.ts    # Busca por similaridade (SRP)
│   │       ├── RAGManager.ts   # Orquestrador do pipeline RAG (DI via construtor)
│   │       ├── ReActLoop.ts    # Loop Reasoning + Acting (Strategy)
│   │       └── graph/
│   │           ├── index.ts               # Re-exports do módulo GraphRAG
│   │           ├── types.ts               # KnowledgeGraph, GraphNode, GraphEdge
│   │           ├── IGraphStore.ts         # Interface de persistência (ISP/DIP)
│   │           ├── IRelationshipExtractor.ts # Interface de extração (ISP/DIP)
│   │           ├── IGraphQuery.ts         # Interface de consulta (ISP/DIP)
│   │           ├── JsonGraphStore.ts      # Persistência JSON (SRP)
│   │           ├── ASTRelationshipExtractor.ts # Extração via AST (SRP)
│   │           ├── GraphBuilder.ts        # Construtor do grafo (SRP)
│   │           └── GraphRAGManager.ts     # Busca híbrida vetorial + grafo (SRP)
│   ├── providers/
│   │   ├── index.ts            # Re-exports públicos do módulo providers
│   │   ├── types.ts            # Interfaces: IProvider, IEmbedProvider, ChatRequest, etc.
│   │   ├── OllamaProvider.ts   # Provider Ollama (chat + streamChat + embed)
│   │   └── OllamaHttpClient.ts # Cliente HTTP de baixo nível (post + postStream)
│   └── validation/
│       └── JsonValidator.ts    # Validador JSON puro (SRP, zero dependências)
```

---

## ⚙️ Módulo Core (`src/core/`)

### FileReader (`FileReader.ts`)

Abstração sobre o sistema de arquivos do Node.js (`fs/promises`). Toda operação é assíncrona (Promise-based).

**Métodos estáticos:**
| Método | Descrição |
|--------|-----------|
| `resolveSecurePath(userPath)` | **(async)** Resolve caminho e valida contra Path Traversal + Symlink Attacks (C-1). Usa `fs.realpath()` no caminho do usuário e no rootDir para prevenir ataques via symlinks maliciosos |

**Métodos de instância:**
| Método | Descrição |
|--------|-----------|
| `readFile(filePath)` | Lê conteúdo completo de um arquivo (UTF-8) |
| `readDir(dirPath)` | Lista entradas (arquivos/diretórios) de um diretório |
| `searchFiles(rootDir, pattern, maxResults?)` | Busca recursiva por padrão textual em arquivos; retorna `SearchResult[]` |

**Tipos exportados:**
- `SearchResult`: `{ file: string; line: number; content: string }`

> **Nota:** `resolveSecurePath` foi tornado **assíncrono** (retorna `Promise<string>`) para suportar `fs.promises.realpath()` — mitigação contra Symlink Attacks (C-1). Todos os métodos de instância e consumidores (`ASTEditor`, `SearchReplaceEditor`) usam `await`.

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

Gerencia o pipeline de Retrieval-Augmented Generation: chunking de arquivos, geração de embeddings, busca por similaridade de cosseno, cache em disco e GraphRAG. Zero dependências externas (usa apenas `node:fs/promises`, `node:path`, `node:crypto`).

**Injeção de Dependências (DIP):** O `RAGManager` recebe todas as suas dependências via construtor (`IChunker`, `Embedder`, `Retriever`, `VectorStore`, `GraphBuilder`, `IGraphStore`, `IRelationshipExtractor`, `IGraphQuery`). Nenhuma instância é criada internamente — facilitando testes e substituição de implementações.

**Métodos:**
| Método | Descrição |
|--------|-----------|
| `ensureIndex(dir)` | Indexa diretório (chunks → embeddings → cache + GraphBuilder). Só reindexa se houver mudanças |
| `retrieve(query, dir)` | Busca semântica + GraphRAG enhancement: top 5 chunks por cosine similarity, expandidos com adjacências do grafo |
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
- **Embeddings:** método `embed(request)` que envia POST para `/api/embed` com `keep_alive` configurável
- **Vetores 384-dim:** retorna `number[]` (float32) padrão do modelo all-minilm
- **Streaming SSE:** método `streamChat()` retorna `AsyncIterable<string>` que emite tokens um a um conforme chegam do servidor. O ReActLoop consome este stream nativamente via `for await...of` quando `stream.enabled = true` e `stream.onToken` é fornecido
- **Validação de robustez:** se `format: 'json'` foi solicitado, a resposta é validada com `JSON.parse()` dentro de `try/catch`. Se o modelo alucinar JSON inválido, um erro claro é lançado protegendo o CLI
- Timeout de 300 segundos para respostas de modelos grandes
- Tratamento de erros de rede, parsing e status HTTP

### OllamaHttpClient (`OllamaHttpClient.ts`)

Cliente HTTP de baixo nível extraído do `OllamaProvider` (SRP — Single Responsibility Principle). Responsável exclusivamente por gerenciar conexões TCP, timeouts e parsing de respostas HTTP.

**Métodos:**
| Método | Descrição |
|--------|-----------|
| `post(path, body)` | POST comum — retorna Promise do JSON parseado |
| `postStream(path, body)` | POST com streaming — retorna `AsyncGenerator<string>` que processa chunks TCP linha a linha |

**Fluxo do `postStream`:**
1. Conecta via `http.request`
2. Aguarda `req.on('response')` em vez de callback (para suportar async generator)
3. Processa chunks TCP linha a linha com buffer de linha parcial
4. Cada linha completa é parseada como JSON e extrai o campo `"response"`
5. O loop termina ao receber um objeto com `"done": true`

Zero dependências externas — usa exclusivamente `node:http`.

---

## 🖥️ CLI (`src/cli/`)

### Estratégias de Chat (`src/cli/strategies/`)

O comando `chat` usa o **Strategy Pattern** (OCP) para suportar múltiplos pipelines de execução:

| Estratégia | Arquivo | Quando usada |
|------------|---------|--------------|
| `StreamStrategy` | `StreamStrategy.ts` | `--stream` ativo, `--json` desligado, e provider suporta `streamChat` |
| `ReActStrategy` | `ReActStrategy.ts` | Padrão (fallback) — quando `--json` está ativo ou streaming não é suportado |

**StreamStrategy** — Streaming direto (efeito máquina de escrever):
1. Constrói system prompt completo (com RAG se `--rag`)
2. Itera sobre `provider.streamChat()` escrevendo cada token em `process.stdout`
3. Se `streamChat` falhar, faz fallback para `chat()` normal
4. Exibe `[modelo]` como prefixo da resposta

**ReActStrategy** — ReAct Loop (Reasoning + Acting):
1. Constrói system prompt completo (RAG + tools)
2. Executa `ReActLoop.execute()` — loop de raciocínio com ferramentas
3. Se `--stream` estiver ativo, faz streaming da resposta final pós-ReAct
4. Exibe indicador `🤔 Pensando...` no stderr (desativável com `--no-think`)
5. Se streaming falhar, mostra resposta completa de uma vez


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
| `chat` | `soberano chat <prompt> [--model] [--ollama] [--ollama-port] [--json] [--rag <dir>] [--session <id>] [--new-session]` | Envia prompt para modelo Ollama com suporte a RAG e multi-turn |
| `sessions` | `soberano sessions` | Lista sessões de conversa salvas |

**Flags do comando `chat`:**
- `--model <name>` — Modelo Ollama (padrão: `llama3.2:1b`)
- `--ollama <host>` — Host do servidor Ollama (padrão: `localhost`)
- `--ollama-port <port>` — Porta do Ollama (padrão: `11434`)
- `--json` — Ativa Grammar Restraint: força resposta em JSON estrito e injeta system prompt `"Responda estritamente em formato JSON válido."`
- `--rag <dir>` — Ativa RAG: indexa diretório e injeta chunks relevantes no contexto
- `--session <id>` — Carrega uma sessão existente pelo UUID (retoma contexto da conversa anterior)
- `--new-session` — Força a criação de uma nova sessão (ignora `--session`)

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

## 🔧 Tópico 12 — Self-Correction / Reflection Layer (Reflector)

### Visão Geral

O **Reflector** (`src/core/Reflector.ts`) é uma camada opcional de auto-correção que entra em ação **após** a resposta final ser gerada pelo ReAct Loop. Ele submete a resposta a um sistema de crítica (segunda chamada ao mesmo modelo, com baixa temperatura, via `ICritiqueProvider`), e retorna uma versão corrigida se problemas forem detectados.

### Arquitetura SOLID

```
┌──────────────────────────────────────────────────────────────────┐
│                         ReActLoop                                 │
│                                                                  │
│  1. execute() → modo texto ou JSON                               │
│  2. Obtém finalAnswer + iterations                               │
│  3. Se --reflect=true → applyReflection()                        │
│       └── Reflector.reflect(finalAnswer, model)                  │
│       └── Retorna ReflectionResult                               │
│          { finalContent, correctionStatus, errors }              │
│  4. ReActLoop mescla resultado no ReActResult                    │
│                                                                  │
│  Propriedades no resultado:                                      │
│  - correctionStatus: 'stable' | 'suspicious' | 'rejected'       │
│  - errors: ReflectionError[]                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Interfaces

```typescript
// ICritiqueProvider — ISP: especializado para crítica (não IProvider genérico)
interface ICritiqueProvider {
  readonly name: string;
  critique(request: CritiqueRequest): Promise<CritiqueResponse>;
}

// CorrectionStatus — três estados (substitui wasCorrected: boolean)
type CorrectionStatus = 'stable' | 'suspicious' | 'rejected';

interface ReflectionError {
  type: 'hallucination' | 'syntax' | 'inconsistency' | 'logic';
  description: string;
}

interface ReflectionResult {
  finalContent: string;         // Conteúdo corrigido (ou original)
  correctionStatus: CorrectionStatus; // Status da correção
  errors: ReflectionError[];    // Erros encontrados (vazio se nenhum)
}

// IReflectionContext — DIP: contexto formal de reflexão
interface IReflectionContext {
  enabled: boolean;
  model: string;
  temperature?: number;  // default 0.1
  verbose?: boolean;
}
```

### Prompt de Crítica (CRITICAL_SYSTEM_PROMPT) — Otimizado (TASK 9)

Reduzido de ~40 para ~20 linhas, consumindo menos tokens:

```
Analise criticamente a resposta abaixo.

REGRAS:
- Alucinação: API/biblioteca/função que não existe no Node.js nativo
- Erro sintaxe: JSON inválido, await sem async, chaves desbalanceadas
- Ferramenta inválida: usar {TOOLS_LIST} com nome ou parâmetro errado

FORMATO RESPOSTA (JSON puro):
{"hasError":bool,"errors":[...],"correctedOutput":"string"}

REGRAS EXTRAS:
- Se não houver erro: hasError=false, correctedOutput=resposta original
- NÃO invente erros nem adicione info nova na correção
```

### Circuit Breaker (TASK 3) — Dice Coefficient

O Circuit Breaker valida a qualidade da correção antes de aceitá-la:

1. **Se similaridade > 90%** entre original e corrigido → `correctionStatus: 'suspicious'` (falso positivo — mantém original)
2. **Se similaridade < 20%** → `correctionStatus: 'suspicious'` (alucinação do crítico — descarta correção)
3. **Entre 20% e 90%** → `correctionStatus: 'stable'` (correção válida — aceita)

O algoritmo usa **Dice Coefficient sobre bigramas** — leve, rápido e eficaz para detectar mudanças reais.

### ErrorJournal (TASK 6) — Persistência

O `ErrorJournal` (`src/core/ErrorJournal.ts`) persiste erros de reflexão em disco:

```typescript
class ErrorJournal {
  addEntry(entry: Omit<ErrorJournalEntry, 'timestamp'>): void;
  getRecentEntries(options?: { limit?: number; type?: string }): ErrorJournalEntry[];
  getStats(): { total: number; byType: Record<string, number> };
}
```

- Formato JSON versionado (`version: 1`)
- Arquivo: `.soberano/error-journal.json`
- FIFO: máximo 1024 entradas
- Tolerante a falhas: arquivo corrompido ou versão inválida → retorna vazio

### Mecanismos de Robustez

| Mecanismo | Descrição |
|-----------|-----------|
| **Fallback silencioso** | Se o JSON de retorno for inválido ou timeout, retorna original com `correctionStatus: 'rejected'` |
| **Flag `--reflect`** | Só ativa se explicitamente solicitado pelo usuário |
| **String vazia** | Se `finalAnswer` for vazio, não perde tempo com crítica |
| **Baixa temperatura** | `temperature: 0.1` → resposta mais determinística |
| **Circuit Breaker** | Dice Coefficient 0.2–0.9 previne falsos positivos e alucinações do crítico |
| **ErrorJournal** | Persistência de erros com limite FIFO e tolerância a corrupção |
| **Flag `--verbose`** | Exibe detalhes da correção no stderr |
| **Sem dependências** | Zero dependências externas — apenas `ICritiqueProvider` injetado |

### Exemplo de uso

```bash
# Chat com auto-correção ativada
npm run dev -- chat "Explique SOLID" --reflect

# ReAct + JSON + auto-correção + verbose
npm run dev -- chat "Qual o conteúdo do package.json?" --json --reflect --verbose

# Chat normal (sem reflexão)
npm run dev -- chat "Explique SOLID"
```

> **Nota:** A reflexão dobra o número de chamadas ao modelo (1 para gerar + 1 para criticar). Em hardware de 12GB RAM, o overhead é de ~2-5 segundos adicionais por resposta. Recomendado para respostas importantes ou quando a precisão é crítica.

---

## 🔧 Tópico 13 — Retrieval-Augmented Generation (RAG)

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

## 🔧 Tópico 14 — Memória Episódica / Multi-turn (Sessões de Conversa)

### Visão Geral

A **Memória Episódica** permite que o Soberano-Core mantenha o contexto de conversas entre múltiplas execuções do terminal. Cada sessão de chat é salva em disco como um arquivo `.json` dentro do diretório `.soberano/sessions/`, e pode ser retomada em qualquer momento usando a flag `--session <id>`.

### Arquitetura SOLID

A feature foi implementada com duas classes de responsabilidade única:

```
┌───────────────────────────────────────────────────────────────┐
│                      SessionStore                              │
│  (Persistência — SRP: ler/escrever arquivos .json em disco)    │
│                                                               │
│  Diretório: .soberano/sessions/<uuid>.json                    │
│                                                               │
│  + save(session): Promise<void>                               │
│  + load(sessionId): Promise<Session | null>                   │
│  + list(): Promise<SessionSummary[]>                          │
│  + delete(sessionId): Promise<void>                           │
└───────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│                      SessionManager                            │
│  (Orquestração — SRP: gerenciar sessão ativa em memória)      │
│                                                               │
│  + addMessage(msg, model): Promise<void>                      │
│  + getHistory(): ChatMessage[]                                │
│  + newSession(model): void                                    │
│  + loadSession(sessionId): Promise<boolean>                   │
│  + flush(): Promise<void>                                     │
│  + listSessions(): Promise<SessionSummary[]>                  │
│  + deleteSession(sessionId): Promise<void>                    │
│  + getSessionId(): string | null                              │
└───────────────────────────────────────────────────────────────┘
```

### Interface SessionStore (`ISessionStore` — DIP)

A `SessionStore` agora implementa a interface `ISessionStore`, seguindo o **Dependency Inversion Principle**. O `SessionManager` depende da abstração (`ISessionStore`), não da implementação concreta.

```typescript
interface ISessionStore {
  save(session: Session): Promise<void>;
  load(sessionId: string): Promise<Session | null>;
  list(): Promise<SessionSummary[]>;
  delete(sessionId: string): Promise<void>;
}

interface Session {
  id: string;                    // UUID v4
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  messages: ReActMessage[];      // Array de mensagens (tipo ReActMessage do ReActLoop)
  metadata?: {                   // Metadados opcionais agrupados
    model?: string;              // Modelo utilizado (ex: "llama3.2:1b")
    title?: string;              // Título auto-extraído da 1ª mensagem (máx 80 chars)
  };
}

interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
}
```

> **Mudanças:** `messages` agora usa `ReActMessage[]` (tipo compartilhado com `ReActLoop`), `model` e `title` foram movidos para `metadata` aninhado, `title` pode ser `undefined` em vez de `null`, e a listagem usa `Promise.allSettled` para paralelismo com tolerância a falhas.

### Fluxo de uso (exemplo real)

```bash
# Primeira interação → cria sessão automaticamente
npm run dev -- chat "Qual a capital do Brasil?"

# O SessionManager cria a sessão, adiciona a mensagem,
# executa o chat, adiciona a resposta, faz flush().
# Arquivo gerado: .soberano/sessions/<uuid>.json

# Segunda interação: retomar a conversa
npm run dev -- chat "E a população dela?" --session <uuid>

# O SessionManager carrega o histórico (role: 'user'/'assistant'),
# o ReActStrategy/StreamStrategy chama getHistory() e
# constrói o prompt completo com todo o contexto anterior.

# Forçar nova sessão (ignorar --session)
npm run dev -- chat "Nova conversa" --new-session

# Listar todas as sessões
npm run dev -- sessions
# Saída:
#   abc12345...  09/05/2026 14:30:00  [3 msgs]  Qual a capital do Brasil?
```

### Integração com o fluxo de chat

No `commands.ts`, o fluxo do comando `chat` agora inclui:

1. **Antes da execução:** `sessionManager.addMessage({ role: 'user', content: prompt })` — adiciona a pergunta do usuário ao histórico
2. **Injeção de contexto:** A estratégia (ReActStrategy/StreamStrategy) chama `sessionManager.getHistory()` para obter todas as mensagens anteriores e as converte no formato `role: "user"/"assistant"` para o prompt multi-turn
3. **Após a execução:** `sessionManager.addMessage({ role: 'assistant', content: result })` — adiciona a resposta ao histórico
4. **Persistência:** `sessionManager.flush()` — salva o arquivo `.json` em disco

### Mecanismos de robustez

| Mecanismo | Descrição |
|-----------|-----------|
| **Criação automática** | `addMessage()` sem sessão ativa → cria nova sessão automaticamente com UUID v4 |
| **Extração de título** | A primeira mensagem do usuário vira o título (truncado em 80 caracteres) |
| **Flush explícito** | A sessão só é persistida quando `flush()` é chamado — evita I/O em cada mensagem |
| **Criação de diretório** | `mkdir({ recursive: true })` garante que `.soberano/sessions/` exista |
| **Arquivo corrompido** | `SessionStore.load()` retorna `null` se JSON for inválido (não quebra o CLI) |
| **Sessão inexistente** | `loadSession()` retorna `false` se não encontrar o arquivo |
| **Zero dependências** | UUID v4 gerado com `crypto.randomUUID()` (nativo do Node.js 19+) |
| **Data ISO 8601** | Timestamps gerados com `new Date().toISOString()` |

### Exemplos de uso

```bash
# Fluxo multi-turn completo
npm run dev -- chat "Explique o que é SOLID" --model phi3:3b
# → Sessão criada automaticamente (mostra o UUID no stderr)

npm run dev -- chat "Dê um exemplo de cada princípio" --session <uuid>
# → Contexto preservado da conversa anterior

# Listar sessões
npm run dev -- sessions

# Forçar nova sessão
npm run dev -- chat "Nova conversa" --new-session
```

---

## 🔧 Tópico 15 — GraphRAG: Busca Híbrida Vetorial + Grafo de Conhecimento

### Visão Geral

O **GraphRAG** estende o RAG clássico com um **grafo de conhecimento** que mapeia relações estruturais entre arquivos do projeto: imports, exports, herança de classes e chamadas de funções. A busca híbrida combina similaridade vetorial (chunks semânticos) com navegação no grafo (relações topológicas) para resultados mais precisos.

### Arquitetura SOLID

```
┌──────────────────────────────────────────────────────────────────┐
│                    RAGManager (orquestrador)                       │
│                                                                   │
│  ensureIndex(dir)                                                 │
│    └── Chunker → chunks                                           │
│    └── Embedder → embeddings                                      │
│    └── GraphBuilder.build(chunks) → KnowledgeGraph                │
│    └── JsonGraphStore.save(graph)                                 │
│    └── VectorStore.save(embeddings)                               │
│                                                                   │
│  retrieve(query, dir)                                             │
│    └── Retriever → top 5 chunks (vetorial)                        │
│    └── GraphRAGManager.enhance(query, top5, graph) → merged       │
│    └── Retorna SearchMatch[] combinado                            │
└──────────────────────────────────────────────────────────────────┘
```

### Interfaces e Classes (SRP + ISP)

| Interface/Classe | Arquivo | Responsabilidade |
|-----------------|---------|-----------------|
| `KnowledgeGraph`, `GraphNode`, `GraphEdge` | `types.ts` | Tipos de domínio do grafo |
| `IGraphStore` | `IGraphStore.ts` | Contrato de persistência do grafo |
| `IRelationshipExtractor` | `IRelationshipExtractor.ts` | Contrato de extração de relações de texto |
| `IGraphQuery` | `IGraphQuery.ts` | Contrato de consulta (busca por similaridade + adjacência) |
| `JsonGraphStore` | `JsonGraphStore.ts` | Persistência do grafo em `.soberano/graph.json` (SRP) |
| `ASTRelationshipExtractor` | `ASTRelationshipExtractor.ts` | Extrai imports/exports/herança do AST TypeScript (SRP) |
| `GraphBuilder` | `GraphBuilder.ts` | Constrói o grafo a partir de chunks usando extractors (SRP) |
| `GraphRAGManager` | `GraphRAGManager.ts` | Busca híbrida: vetorial + adjacência no grafo (SRP) |

### KnowledgeGraph — Estrutura de Dados

```typescript
interface GraphNode {
  id: string;              // "src/core/ReActLoop.ts"
  label: string;           // "ReActLoop"
  type: 'file' | 'class' | 'function' | 'interface' | 'variable';
  filePath: string;
  line: number;
}

interface GraphEdge {
  source: string;          // node id de origem
  target: string;          // node id de destino
  relationship: 'imports' | 'exports' | 'extends' | 'implements' | 'calls';
}

interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}
```

### Pipeline GraphRAG no RAGManager.ensureIndex()

1. **Chunking:** Arquivos são divididos em chunks (512 chars, overlap 64)
2. **Embeddings:** Cada chunk é convertido em vetor 384-dim (all-minilm)
3. **GraphBuilder.build(chunks):**
   - Para cada chunk, extrai relações via `ASTRelationshipExtractor.extract(chunk.text)`
   - Converte relações em nós e arestas do grafo
   - Deduplica nós e arestas por ID único
4. **Persistência:** Grafo salvo em `.soberano/graph.json`, embeddings em `.soberano/index.json`

### Pipeline de Busca Híbrida (GraphRAGManager.enhance())

```
Usuário: "Como o ReActLoop chama o ToolRegistry?"

1. Retriever.query → top 5 chunks por cosine similarity
2. GraphRAGManager.enhance(query, top5, graph):
   a. Para cada chunk nos top5, busca nós adjacentes no grafo
   b. Adiciona chunks dos nós vizinhos (com decay de score * 0.8)
   c. Limita a no máximo 8 chunks no total
   d. Reordena por score descendente
3. Retorna top 5 (ou menos) da lista mesclada
4. PromptBuilder injeta no contexto
```

### Mecanismos de robustez

| Mecanismo | Descrição |
|-----------|-----------|
| **Fallback vetorial puro** | Se o grafo não existir ou `enhance()` lançar erro, cai para busca vetorial clássica |
| **Sem dependências** | O AST extractor usa `node:fs` + regex para detectar imports/exports (sem parser TypeScript real) |
| **Cache do grafo** | `JsonGraphStore.save()` só persiste se houve mudanças (hash dos chunks) |
| **Decay de score** | Chunks do grafo entram com score * 0.8 para não dominarem os puramente vetoriais |
| **Limite de expansão** | Máximo 8 chunks no total pós-expansão (evita lentidão em projetos grandes) |
| **Arquivo corrompido** | `load()` retorna `null` se JSON for inválido → `GraphRAGManager` usa fallback |

### Exemplo de uso

```bash
# RAG clássico + GraphRAG (automático, sem flag extra)
npm run dev -- chat "Como o ToolRegistry registra ferramentas?" --rag .

# O GraphRAGManager.enhance() expande os top5 chunks com
# nós vizinhos no grafo (arquivos que importam ToolRegistry)
```

---

## 🧪 Testes Unitários

A suíte de testes usa **Vitest** (v4.1.5) e está organizada em `tests/unit/`, espelhando a estrutura do `src/`.

### Cobertura atual

| Módulo | Arquivo | Testes | O que cobre |
|--------|---------|--------|-------------|
| **Core** | `tests/unit/core/ToolRegistry.test.ts` | 9 | Registro de tools, execução com/sem parâmetros, validação de existência |
| **Core** | `tests/unit/core/CommandExecutor.test.ts` | 3 | Execução de comandos, captura stderr, erro de spawn |
| **Core** | `tests/unit/core/Reflector.test.ts` | 12 | Instanciação, resposta correta (sem correção), resposta incorreta (com correção), resposta vazia/só espaços, JSON inválido, múltiplos erros, integração com toolRegistry, fallback de rede, Circuit Breaker (similaridade >90%, <20%), ICritiqueProvider |
| **Core** | `tests/unit/core/ErrorJournal.test.ts` | 8 | Criação, persistência, ordenação, filtro por tipo, limite FIFO, stats, arquivo corrompido, versão inválida |
| **Providers** | `tests/unit/providers/OllamaProvider.test.ts` | 12 | Chat com parâmetros, format=json, erro HTTP, embed. **Streaming:** tokens individuais, body com stream:true, erro HTTP no stream, linhas vazias/não-JSON, chunks TCP quebrados |
| **RAG** | `tests/unit/rag/Retriever.test.ts` | 13 | Cosine similarity, rankeamento, ordenação, busca vazia |
| **RAG** | `tests/unit/rag/ReActLoop.test.ts` | 26 | Text Mode, JSON Mode, Reflector, Streaming. Loop com mensagens tipadas via ReActMessage |
| **RAG** | `tests/unit/rag/Chunker.test.ts` | 8 | Chunking por parágrafo, sentença, overlap, limite de chunks |
| **RAG** | `tests/unit/rag/TypescriptASTAdapter.test.ts` | 19 | Roteamento de extensões (.ts, .js, .tsx, .jsx, .mjs, .cjs), fallback para não-código, parse de classes/funções/imports/exports, ASTNode structure, empty file handling |
| **Graph** | `tests/unit/graph/JsonGraphStore.test.ts` | 20 | CRUD do grafo, persistência JSON, operações de escrita (IGraphStore) |
| **Graph** | `tests/unit/graph/ASTRelationshipExtractor.test.ts` | 17 | Extração de relações de imports/exports/herança via AST |
| **Graph** | `tests/unit/graph/GraphBuilder.test.ts` | 9 | Construção do grafo a partir de chunks, extração cíclica de relações |
| **Graph** | `tests/unit/graph/GraphRAGManager.test.ts` | 12 | Busca híbrida (vetorial + grafo), fallback para vetorial puro, convergência de resultados |
| **RAG** | `tests/unit/rag/ASTChunkerService.test.ts` | 9 | Extension routing (AST vs fallback), AST parse results, large class subdivision (métodos como chunks individuais), large non-class node subdivision, MAX_CHUNKS_PER_FILE limit |
| **Validation** | `tests/unit/validation/JsonValidator.test.ts` | 13 | validate(), tryValidate(), ValidationError |
| **CLI** | `tests/unit/cli/commands.test.ts` | 15 | Comandos read/dir/search/exec/chat, flags --stream/--json/--no-think, fallback streaming direto, erro de comando faltando |

**Total: 308 testes, todos passando.**

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
- ✅ **SOLID implementado** — SRP (classes coesas), OCP (ProviderFactory), LSP (IProvider), ISP (interfaces enxutas), DIP (AppContext + injeção de dependências + ISessionStore + RAGManager DI)
- ✅ **FileReader.resolveSecurePath()** tornado assíncrono com `fs.realpath()` — mitigação contra Symlink Attacks (C-1)
- ✅ **SessionStore** refatorada com interface `ISessionStore` (DIP) e `ReActMessage` tipada do `ReActLoop`
- ✅ **RAGManager** refatorado com injeção de dependências via construtor (DIP) — removeu `PromptBuilder.ts` (arquivo deletado, duplicado)
- ✅ **ASTEditor e SearchReplaceEditor** corrigidos para usar `await` em `resolveSecurePath()`
- ✅ **308 testes unitários** passando com Vitest (25 arquivos de teste: ToolRegistry, CommandExecutor, Reflector, ErrorJournal, SessionStore, SessionManager, OllamaProvider, Retriever, ReActLoop, Chunker, TypescriptASTAdapter, ASTChunkerService, JsonValidator, commands, JsonGraphStore, ASTRelationshipExtractor, GraphBuilder, GraphRAGManager, ChatStrategy, ASTEditor, SearchReplaceEditor, TokenEstimator, StatefulCompressor, IContextCompressor, GraphRAGManager)

📝 **Possíveis próximos passos (não implementados):**
- [já implementado] ~~Adicionar streaming de respostas do Ollama (SSE)~~
- [já implementado] ~~Adicionar camada de auto-correção (Reflector + --reflect)~~
- [já implementado] ~~Adicionar suporte a sessões/conversa com histórico (multi-turn)~~
- [já implementado] ~~Adicionar GraphRAG — busca híbrida vetorial + grafo de conhecimento~~
- Implementar novos providers (OpenAI, Anthropic, etc.)
- Expandir ToolRegistry com mais ferramentas (writeFile, searchFiles, etc.)
- Melhorar chunking com overlap adaptativo por estrutura (AST-aware)
- Adicionar reranking multi-stage para melhorar precisão da busca
- Suporte a PDF, DOCX e outros formatos no RAG

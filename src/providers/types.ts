export interface ChatRequest {
  /** Modelo Ollama a ser usado (ex: "tinyllama:1b", "phi3:3b") */
  model: string;
  /** Prompt do usuário */
  prompt: string;
  /** Temperatura para criatividade (0-1), padrão 0.7 */
  temperature?: number;
  /** Máximo de tokens na resposta */
  max_tokens?: number;
  /** Força o modelo a responder em JSON estrito (ativa format: 'json' no Ollama) */
  format?: 'json';
}

export interface ChatResponse {
  /** Resposta completa gerada pelo modelo */
  response: string;
  /** Modelo utilizado */
  model: string;
  /** Se a resposta foi truncada */
  done: boolean;
}

export interface EmbedResponse {
  /** Array de embeddings gerados (cada input gera um vetor) */
  embeddings: number[][];
}

/**
 * IProvider: Contrato base para provedores de linguagem.
 * 
 * LSP (Liskov Substitution): Qualquer classe que implemente IProvider
 * pode ser usada no lugar de OllamaProvider sem quebrar o sistema.
 * 
 * O método embed() é opcional na interface base (para providers
 * que não suportam embeddings, como APIs de chat puro).
 */
export interface IProvider {
  /** Nome do provider para logging */
  readonly name: string;
  /** Envia um prompt e recebe a resposta do modelo */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /**
   * Gera embedding vetorial para um texto.
   * Opcional por padrão — providers que não suportam embedding
   * podem deixar sem implementação.
   */
  embed?(text: string, embedModel?: string, keepAlive?: string): Promise<number[]>;
  /**
   * Streaming: retorna tokens incrementalmente via AsyncIterable.
   * Opcional — providers que não suportam streaming ou modo legado
   * podem deixar sem implementação (fallback para chat()).
   */
  streamChat?(request: ChatRequest): AsyncIterable<string>;
}

/**
 * IEmbedProvider: Extensão de IProvider para provedores que
 * suportam embeddings (RAG, busca semântica, etc.).
 * 
 * Ao contrário de IProvider.embed() que é opcional, esta interface
 * garante que o método existe em tempo de compilação.
 */
export interface IEmbedProvider extends IProvider {
  embed(text: string, embedModel?: string, keepAlive?: string): Promise<number[]>;
}

// ── Interfaces de Crítica (Self-Correction) ──

export interface CritiqueRequest {
  /** Modelo a ser usado para a crítica */
  model: string;
  /** Prompt completo (system prompt + resposta a analisar) */
  prompt: string;
  /** Temperatura para a crítica (baixa = mais determinístico) */
  temperature?: number;
}

export interface CritiqueResponse {
  /** JSON parseado da resposta do crítico */
  parsedJson: Record<string, unknown>;
  /** Texto cru antes do parse (para debug/fallback) */
  rawText: string;
}

/**
 * Status da correção aplicada pelo Reflector:
 * - 'stable'   → correção confiável, aplicada com sucesso
 * - 'suspicious' → correção aplicada mas com ressalvas (ex: tamanho muito reduzido)
 * - 'rejected'  → correção rejeitada (ex: similaridade muito baixa com original)
 */
export type CorrectionStatus = 'stable' | 'suspicious' | 'rejected';

/**
 * ICritiqueProvider: Interface para provedores que suportam crítica de respostas.
 *
 * LSP (Liskov Substitution): Cada provider implementa o método critique()
 * da sua própria forma (Ollama usa format:'json', OpenAI usaria response_format,
 * Anthropic usaria prompt engineering), sem vazar detalhes de implementação
 * para o Reflector.
 *
 * SRP: Responsabilidade única — submeter um prompt de crítica e retornar JSON.
 */
export interface ICritiqueProvider {
  /** Nome do provider para logging */
  readonly name: string;
  /**
   * Submete um prompt de crítica e retorna o JSON parseado.
   *
   * @param request Prompt completo de crítica + resposta a analisar
   * @returns Resposta parseada (parsedJson + rawText para fallback)
   */
  critique(request: CritiqueRequest): Promise<CritiqueResponse>;
}

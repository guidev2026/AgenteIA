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
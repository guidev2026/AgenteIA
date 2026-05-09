export interface ChatRequest {
  /** Modelo Ollama a ser usado (ex: "tinyllama:1b", "phi3:3b") */
  model: string;
  /** Prompt do usuário */
  prompt: string;
  /** Temperatura para criatividade (0-1), padrão 0.7 */
  temperature?: number;
  /** Máximo de tokens na resposta */
  max_tokens?: number;
}

export interface ChatResponse {
  /** Resposta completa gerada pelo modelo */
  response: string;
  /** Modelo utilizado */
  model: string;
  /** Se a resposta foi truncada */
  done: boolean;
}

export interface IProvider {
  /** Nome do provider para logging */
  readonly name: string;
  /** Envia um prompt e recebe a resposta do modelo */
  chat(request: ChatRequest): Promise<ChatResponse>;
}
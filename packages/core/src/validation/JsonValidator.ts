/**
 * JsonValidator: Validação de respostas JSON de modelos de linguagem.
 *
 * Responsabilidade Única (SRP): Esta classe existe APENAS para validar
 * se uma string é um JSON válido. Ela não formata prompts, não gerencia
 * conexões HTTP, não lida com provedores de linguagem.
 *
 * Uso típico:
 *   const validator = new JsonValidator();
 *   const parsed = validator.validate(rawResponse);
 *   // Se falhar, lança ValidationError com preview do conteúdo inválido
 */

export class ValidationError extends Error {
  public readonly rawPreview: string;

  constructor(message: string, raw: string) {
    super(message);
    this.name = 'ValidationError';
    this.rawPreview = raw.slice(0, 200);
  }
}

export class JsonValidator {
  /**
   * Valida se uma string é um JSON válido e retorna o objeto parseado.
   *
   * @param raw String bruta recebida do modelo
   * @param contextLabel Rótulo para mensagem de erro (ex: "Ollama response")
   * @returns Objeto parseado
   * @throws ValidationError se o JSON for inválido
   */
  validate<T = Record<string, unknown>>(raw: string, contextLabel: string = 'response'): T {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new ValidationError(
        `Failed to parse ${contextLabel} as JSON. ` +
        `Raw preview: ${raw.slice(0, 200)}`,
        raw
      );
    }
  }

  /**
   * Valida que a resposta do modelo, quando solicitado format:'json',
   * é realmente um JSON válido. Se falhar, retorna null em vez de lançar
   * exceção (útil para fallbacks).
   */
  tryValidate<T = Record<string, unknown>>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
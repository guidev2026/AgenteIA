/**
 * ToolRegistry: Registro de ferramentas (tools) no formato JSON Schema
 * compatível com Function Calling / Tool Use do Ollama.
 *
 * Arquitetura:
 * ┌─────────────────────────────────────────────────────────┐
 * │                   ToolRegistry                          │
 * │                                                         │
 * │  tools: Map<                                               │
 * │    string,                // nome da tool               │
 * │    {                                                    │
 * │      definition: {...},   // JSON Schema (LLM-readable) │
 * │      handler: Function    // executa a tool de fato     │
 * │    }                                                    │
 * │  >                                                      │
 * │                                                         │
 * │  + register(name, description, paramsSchema, handler)   │
 * │  + getDefinitions(): string   // JSON string p/ prompt  │
 * │  + execute(name, args): Promise    // chama handler     │
 * │  + hasTool(name): boolean                               │
 * │  + getToolNames(): string[]                              │
 * └─────────────────────────────────────────────────────────┘
 *
 * Segurança:
 * - execute() verifica se a tool existe antes de chamar o handler,
 *   prevenindo execução de funções arbitrárias.
 * - Os handlers são registrados explicitamente via register(), nunca
 *   expostos dinamicamente a partir de input do usuário/LLM.
 */

/**
 * Definição de uma ferramenta no formato JSON Schema (padrão OpenAI/Function Calling).
 * É o que o LLM recebe para decidir qual tool chamar e com quais argumentos.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

/**
 * Entrada completa de uma tool no registro: definição + handler.
 */
interface ToolEntry {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export class ToolRegistry {
  private tools: Map<string, ToolEntry> = new Map();

  /**
   * Registra uma nova ferramenta no registro.
   *
   * @param name        Nome único da tool (ex: 'readFile', 'execute')
   * @param description Descrição legível para o LLM
   * @param paramsSchema Schema dos parâmetros: { prop: { type, description } }
   * @param handler     Função que executa a tool. Recebe args e retorna string.
   */
  register(
    name: string,
    description: string,
    paramsSchema: Record<string, { type: string; description: string }>,
    handler: (args: Record<string, unknown>) => Promise<string>
  ): void {
    const required = Object.keys(paramsSchema);
    const definition: ToolDefinition = {
      type: 'function',
      function: {
        name,
        description,
        parameters: {
          type: 'object',
          properties: paramsSchema,
          required,
        },
      },
    };

    this.tools.set(name, { definition, handler });
  }

  /**
   * Retorna a lista de definições de todas as tools registradas
   * serializada como JSON string, pronta para ser injetada no system prompt.
   *
   * Formato:
   * [
   *   {
   *     "type": "function",
   *     "function": { "name": "readFile", "description": "...", "parameters": {...} }
   *   },
   *   ...
   * ]
   */
  getDefinitions(): string {
    const defs = Array.from(this.tools.values()).map((t) => t.definition);
    return JSON.stringify(defs, null, 2);
  }

  /**
   * Retorna a lista de nomes de tools registradas.
   * Útil para validação e para o system prompt.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Verifica se uma tool com o nome informado existe no registro.
   * Usado para validação de segurança antes de executar.
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Executa uma tool pelo nome, passando os argumentos.
   *
   * Pipeline de segurança:
   *   1. Verifica se a tool existe no registro
   *   2. Se não existe → lança erro (previne execução arbitrária)
   *   3. Chama o handler registrado com os args fornecidos
   *   4. Retorna o resultado como string
   *
   * @param name Nome da tool a executar
   * @param args Argumentos para o handler (validados pelo JSON Schema no LLM)
   * @returns Resultado da execução como string
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(
        `Unknown tool: "${name}". Available tools: ${this.getToolNames().join(', ')}`
      );
    }

    return entry.handler(args);
  }
}
/**
 * IASTParser: Interface para parseamento de AST (DIP).
 *
 * Permite que o ASTChunkerService dependa de uma abstração em vez de
 * uma implementação concreta de parser AST. O Adapter concreto
 * (TypescriptASTAdapter) isola a dependência do compilador TypeScript.
 */

/**
 * Nó AST extraído do código fonte.
 */
export interface ASTNode {
  /** Nome do nó: nome da função, classe, interface, etc. */
  name: string;
  /** Tipo do nó: 'FunctionDeclaration' | 'ClassDeclaration' | 'MethodDeclaration' | ... */
  kind: string;
  /** Código fonte completo do nó (assinatura + corpo) */
  text: string;
  /** Linha inicial (1-based) */
  startLine: number;
  /** Linha final (1-based) */
  endLine: number;
}

export interface IASTParser {
  /**
   * Extrai nós semânticos (funções, classes, etc.) do código fonte.
   *
   * @param source Código fonte TypeScript/JavaScript completo
   * @returns Array de nós AST ordenados por startLine.
   *          Retorna array vazio se o código não for TypeScript/JavaScript válido.
   */
  parse(source: string): ASTNode[];
}
/**
 * astUtils: Funções utilitárias compartilhadas para manipulação da AST do TypeScript.
 *
 * Extraída do TypescriptASTAdapter para reuso no ASTEditor.
 * Mantida aqui como módulo independente (sem dependências externas além do 'typescript').
 */

import * as ts from 'typescript';

/**
 * Extrai o nome de um nó da AST (top-level symbol).
 *
 * Lógica idêntica à usada no TypescriptASTAdapter.getNodeName().
 *
 * @param node Nó da AST do TypeScript
 * @param sourceFile SourceFile de referência para obter text spans
 * @returns Nome do símbolo ou '<anonymous>' se não for nomeável
 */
export function getNodeName(node: ts.Node, sourceFile: ts.SourceFile): string {
  const kind = node.kind;

  if (kind === ts.SyntaxKind.ExportAssignment) {
    return 'export_default';
  }

  const nameNode = (node as ts.NamedDeclaration).name;
  if (nameNode) {
    return nameNode.getText(sourceFile);
  }

  // Para VariableStatement, tenta extrair o nome da variável
  if (kind === ts.SyntaxKind.VariableStatement) {
    const varStmt = node as ts.VariableStatement;
    const declarations = varStmt.declarationList.declarations;
    if (declarations.length > 0 && declarations[0].name) {
      return declarations[0].name.getText(sourceFile);
    }
  }

  // Para constructor sem nome explícito
  if (kind === ts.SyntaxKind.Constructor) {
    return 'constructor';
  }

  return '<anonymous>';
}

/**
 * Busca um símbolo top-level pelo nome no SourceFile.
 *
 * Percorre os nós filhos do SourceFile (apenas nível superior) e retorna
 * o primeiro nó cujo nome corresponda exatamente a `symbolName`.
 *
 * @param sourceFile SourceFile parseado
 * @param symbolName Nome do símbolo a buscar
 * @returns O nó encontrado, ou undefined se não existir
 */
export function findTopLevelSymbol(
  sourceFile: ts.SourceFile,
  symbolName: string
): ts.Node | undefined {
  let found: ts.Node | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (found) return; // já encontrou

    const name = getNodeName(node, sourceFile);
    if (name === symbolName) {
      found = node;
    }
  });

  return found;
}
/**
 * TypescriptASTAdapter: Adaptador para o compilador TypeScript (DIP).
 *
 * Implementa IASTParser usando a API nativa do TypeScript (ts.createSourceFile).
 * Aproveita o pacote 'typescript' já instalado como devDependency — sem
 * dependências externas adicionais (regra Zero Dependências).
 *
 * Extrai nós semânticos do código fonte:
 * - FunctionDeclaration, ClassDeclaration, MethodDeclaration
 * - InterfaceDeclaration, EnumDeclaration, TypeAliasDeclaration
 * - VariableStatement (const/let/var com arrow functions)
 * - ExportAssignment (export default)
 */

import * as ts from 'typescript';
import type { IASTParser, ASTNode } from './IASTParser';

export class TypescriptASTAdapter implements IASTParser {
  /**
   * Extrai nós semânticos do código fonte TypeScript/JavaScript.
   *
   * Percorre a árvore sintática e extrai declarações de alto nível que
   * representam blocos semânticos completos (funções, classes, etc.).
   *
   * @param source Código fonte completo
   * @returns Array de nós AST ordenados por startLine.
   *          Array vazio se o parse falhar ou código for inválido.
   */
  parse(source: string): ASTNode[] {
    if (!source || !source.trim()) return [];

    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        source,
        ts.ScriptTarget.Latest,
        true
      );

      const nodes: ASTNode[] = [];
      this.extractNodes(sourceFile, source, sourceFile, nodes);

      // Ordena por startLine
      nodes.sort((a, b) => a.startLine - b.startLine);
      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * Percorre recursivamente os nós filhos e extrai os nós semânticos.
   *
   * @param node Nó atual da AST
   * @param source Código fonte original
   * @param sourceFile SourceFile para calcular line/character
   * @param nodes Array acumulador de nós encontrados
   */
  private extractNodes(
    node: ts.Node,
    source: string,
    sourceFile: ts.SourceFile,
    nodes: ASTNode[]
  ): void {
    // Só processa nós de alto nível (statements) exceto para métodos de classe
    const shouldExtract = this.shouldExtractNode(node);
    if (shouldExtract) {
      const name = this.getNodeName(node, source, sourceFile);
      const kind = this.getNodeKind(node);
      const text = source.substring(node.getStart(sourceFile), node.getEnd());
      const startLine = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1;
      const endLine = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd()).line + 1;

      nodes.push({ name, kind, text, startLine, endLine });
    }

    // Percorre filhos — para MethodDeclaration dentro de ClassDeclaration,
    // isso captura os métodos como nós independentes
    ts.forEachChild(node, (child) => {
      this.extractNodes(child, source, sourceFile, nodes);
    });
  }

  /**
   * Verifica se um nó da AST deve ser extraído como chunk semântico.
   */
  private shouldExtractNode(node: ts.Node): boolean {
    const kind = node.kind;

    // Declarações de alto nível
    if (
      kind === ts.SyntaxKind.FunctionDeclaration ||
      kind === ts.SyntaxKind.ClassDeclaration ||
      kind === ts.SyntaxKind.InterfaceDeclaration ||
      kind === ts.SyntaxKind.EnumDeclaration ||
      kind === ts.SyntaxKind.TypeAliasDeclaration ||
      kind === ts.SyntaxKind.ModuleDeclaration
    ) {
      return true;
    }

    // ExportAssignment: export default <expression>
    // NOTA: export default class/function gera ClassDeclaration/FunctionDeclaration
    // com modificador, NÃO ExportAssignment.
    if (kind === ts.SyntaxKind.ExportAssignment) {
      return true;
    }

    // Métodos dentro de classe (MethodDeclaration, Constructor, GetAccessor, SetAccessor)
    if (
      kind === ts.SyntaxKind.MethodDeclaration ||
      kind === ts.SyntaxKind.Constructor ||
      kind === ts.SyntaxKind.GetAccessor ||
      kind === ts.SyntaxKind.SetAccessor
    ) {
      return true;
    }

    // VariableStatement com arrow function ou declaração relevante
    if (kind === ts.SyntaxKind.VariableStatement) {
      return true;
    }

    return false;
  }

  /**
   * Extrai o nome do nó.
   */
  private getNodeName(node: ts.Node, _source: string, sourceFile: ts.SourceFile): string {
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
   * Retorna o tipo do nó como string legível.
   */
  private getNodeKind(node: ts.Node): string {
    const syntaxKind = node.kind;

    const kindNames: Record<number, string> = {
      [ts.SyntaxKind.FunctionDeclaration]: 'FunctionDeclaration',
      [ts.SyntaxKind.ClassDeclaration]: 'ClassDeclaration',
      [ts.SyntaxKind.InterfaceDeclaration]: 'InterfaceDeclaration',
      [ts.SyntaxKind.EnumDeclaration]: 'EnumDeclaration',
      [ts.SyntaxKind.TypeAliasDeclaration]: 'TypeAliasDeclaration',
      [ts.SyntaxKind.ModuleDeclaration]: 'ModuleDeclaration',
      [ts.SyntaxKind.ExportAssignment]: 'ExportAssignment',
      [ts.SyntaxKind.MethodDeclaration]: 'MethodDeclaration',
      [ts.SyntaxKind.Constructor]: 'Constructor',
      [ts.SyntaxKind.GetAccessor]: 'GetAccessor',
      [ts.SyntaxKind.SetAccessor]: 'SetAccessor',
      [ts.SyntaxKind.VariableStatement]: 'VariableStatement',
    };

    return kindNames[syntaxKind] ?? `Unknown(${syntaxKind})`;
  }
}
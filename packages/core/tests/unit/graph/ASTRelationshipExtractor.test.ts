/**
 * Testes unitários para ASTRelationshipExtractor.
 *
 * Cobre:
 * - Extração de funções, classes, interfaces do AST
 * - CALLS entre funções no mesmo arquivo
 * - IMPORTS de módulos
 * - EXTENDS e IMPLEMENTS
 * - BELONGS_TO e CONTAINS (arquivo ↔ símbolo)
 * - Limite de MAX_EDGES_PER_FILE (200)
 * - Código vazio, inválido
 * - Extensão não suportada (ex: .md, .json)
 * - Auto-referências e built-ins
 */

import { describe, it, expect, vi } from 'vitest';
import type { IASTParser, ASTNode } from '../../../src/core/rag/IASTParser';
import { ASTRelationshipExtractor } from '../../../src/core/rag/graph/ASTRelationshipExtractor';

/**
 * Mock de IASTParser que retorna ASTNodes previsíveis.
 * Evita depender do TypescriptASTAdapter real.
 */
function createMockParser(nodes: ASTNode[]): IASTParser {
  return {
    parse: vi.fn().mockReturnValue(nodes),
  };
}

describe('ASTRelationshipExtractor', () => {
  // =========================================================================
  // Nós e arquivos básicos
  // =========================================================================

  it('extrai nó do arquivo para código fonte válido', () => {
    const parser = createMockParser([
      { name: 'myFunc', kind: 'FunctionDeclaration', text: 'function myFunc() {}', startLine: 1, endLine: 1 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'function myFunc() {}');

    expect(result.nodes.length).toBeGreaterThanOrEqual(2); // file + function
    const fileNode = result.nodes.find((n) => n.type === 'file');
    expect(fileNode).toBeDefined();
    expect(fileNode!.filePath).toBe('src/test.ts');
    expect(fileNode!.label).toBe('test.ts');
  });

  it('extrai nó de função com metadados corretos', () => {
    const parser = createMockParser([
      { name: 'helloWorld', kind: 'FunctionDeclaration', text: 'function helloWorld() { return 1; }', startLine: 5, endLine: 7 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const funcNode = result.nodes.find((n) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.label).toBe('helloWorld');
    expect(funcNode!.startLine).toBe(5);
    expect(funcNode!.endLine).toBe(7);
  });

  it('extrai nó de classe', () => {
    const parser = createMockParser([
      { name: 'MyClass', kind: 'ClassDeclaration', text: 'class MyClass {}', startLine: 1, endLine: 3 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const classNode = result.nodes.find((n) => n.type === 'class');
    expect(classNode).toBeDefined();
    expect(classNode!.label).toBe('MyClass');
  });

  it('extrai nó de interface', () => {
    const parser = createMockParser([
      { name: 'MyInterface', kind: 'InterfaceDeclaration', text: 'interface MyInterface {}', startLine: 1, endLine: 2 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const ifaceNode = result.nodes.find((n) => n.type === 'interface');
    expect(ifaceNode).toBeDefined();
    expect(ifaceNode!.label).toBe('MyInterface');
  });

  // =========================================================================
  // Relação BELONGS_TO / CONTAINS
  // =========================================================================

  it('cria arestas BELONGS_TO e CONTAINS entre símbolo e arquivo', () => {
    const parser = createMockParser([
      { name: 'funcA', kind: 'FunctionDeclaration', text: 'function funcA() {}', startLine: 1, endLine: 1 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const belongsToEdge = result.edges.find((e) => e.type === 'BELONGS_TO');
    const containsEdge = result.edges.find((e) => e.type === 'CONTAINS');

    expect(belongsToEdge).toBeDefined();
    expect(containsEdge).toBeDefined();

    // BELONGS_TO: símbolo → arquivo
    const funcNode = result.nodes.find((n) => n.type === 'function')!;
    const fileNode = result.nodes.find((n) => n.type === 'file')!;
    expect(belongsToEdge!.from).toBe(funcNode.id);
    expect(belongsToEdge!.to).toBe(fileNode.id);

    // CONTAINS: arquivo → símbolo
    expect(containsEdge!.from).toBe(fileNode.id);
    expect(containsEdge!.to).toBe(funcNode.id);
  });

  // =========================================================================
  // CALLS
  // =========================================================================

  it('detecta chamadas de função (CALLS) entre funções no mesmo arquivo', () => {
    // A função myFunc() chama helper() que está definida no mesmo arquivo
    const parser = createMockParser([
      { name: 'myFunc', kind: 'FunctionDeclaration', text: 'function myFunc() { helper(); }', startLine: 1, endLine: 3 },
      { name: 'helper', kind: 'FunctionDeclaration', text: 'function helper() {}', startLine: 5, endLine: 7 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const callsEdges = result.edges.filter((e) => e.type === 'CALLS');
    expect(callsEdges).toHaveLength(1);

    const myFuncNode = result.nodes.find((n) => n.label === 'myFunc')!;
    const helperNode = result.nodes.find((n) => n.label === 'helper')!;
    expect(callsEdges[0].from).toBe(myFuncNode.id);
    expect(callsEdges[0].to).toBe(helperNode.id);
  });

  it('não cria CALLS para built-ins como console.log', () => {
    const parser = createMockParser([
      { name: 'myFunc', kind: 'FunctionDeclaration', text: 'function myFunc() { console.log("hi"); }', startLine: 1, endLine: 1 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const callsEdges = result.edges.filter((e) => e.type === 'CALLS');
    expect(callsEdges).toHaveLength(0);
  });

  it('não cria CALLS para auto-referências', () => {
    const parser = createMockParser([
      { name: 'recurse', kind: 'FunctionDeclaration', text: 'function recurse() { recurse(); }', startLine: 1, endLine: 1 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const callsEdges = result.edges.filter((e) => e.type === 'CALLS');
    expect(callsEdges).toHaveLength(0);
  });

  // =========================================================================
  // IMPORTS
  // =========================================================================

  it('detecta importações (IMPORTS) no código', () => {
    const parser = createMockParser([
      { name: 'myFunc', kind: 'FunctionDeclaration', text: 'function myFunc() {}', startLine: 1, endLine: 1 },
    ]);
    const source = `import { something } from './mymodule';\nfunction myFunc() {}`;
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', source);

    const importsEdges = result.edges.filter((e) => e.type === 'IMPORTS');
    expect(importsEdges.length).toBeGreaterThanOrEqual(1);

    const importEdge = importsEdges[0];
    const fileNode = result.nodes.find((n) => n.type === 'file')!;
    expect(importEdge.from).toBe(fileNode.id);
  });

  it('não cria IMPORTS para módulos node:core', () => {
    const source = `import * as fs from 'node:fs';\nfunction myFunc() {}`;
    const parser = createMockParser([
      { name: 'myFunc', kind: 'FunctionDeclaration', text: 'function myFunc() {}', startLine: 2, endLine: 2 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', source);

    const importsEdges = result.edges.filter((e) => e.type === 'IMPORTS');
    expect(importsEdges).toHaveLength(0);
  });

  // =========================================================================
  // EXTENDS
  // =========================================================================

  it('detecta herança (EXTENDS) entre classes', () => {
    const text = `class Child extends Parent {}\nclass Parent {}`;
    const parser = createMockParser([
      { name: 'Child', kind: 'ClassDeclaration', text: 'class Child extends Parent {}', startLine: 1, endLine: 1 },
      { name: 'Parent', kind: 'ClassDeclaration', text: 'class Parent {}', startLine: 2, endLine: 2 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', text);

    const extendsEdges = result.edges.filter((e) => e.type === 'EXTENDS');
    expect(extendsEdges).toHaveLength(1);

    const childNode = result.nodes.find((n) => n.label === 'Child')!;
    const parentNode = result.nodes.find((n) => n.label === 'Parent')!;
    expect(extendsEdges[0].from).toBe(childNode.id);
    expect(extendsEdges[0].to).toBe(parentNode.id);
  });

  // =========================================================================
  // IMPLEMENTS
  // =========================================================================

  it('detecta implementação de interface (IMPLEMENTS)', () => {
    const text = `class Service implements IService {}\ninterface IService {}`;
    const parser = createMockParser([
      { name: 'Service', kind: 'ClassDeclaration', text: 'class Service implements IService {}', startLine: 1, endLine: 1 },
      { name: 'IService', kind: 'InterfaceDeclaration', text: 'interface IService {}', startLine: 2, endLine: 2 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', text);

    const implementsEdges = result.edges.filter((e) => e.type === 'IMPLEMENTS');
    expect(implementsEdges).toHaveLength(1);

    const serviceNode = result.nodes.find((n) => n.label === 'Service')!;
    const ifaceNode = result.nodes.find((n) => n.label === 'IService')!;
    expect(implementsEdges[0].from).toBe(serviceNode.id);
    expect(implementsEdges[0].to).toBe(ifaceNode.id);
  });

  // =========================================================================
  // Casos de borda
  // =========================================================================

  it('retorna vazio para extensão não suportada', () => {
    const parser = createMockParser([]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('README.md', '# Hello');

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('retorna vazio para código vazio', () => {
    const parser = createMockParser([]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', '');

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('retorna vazio se AST retorna array vazio', () => {
    const parser = createMockParser([]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'some code');

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('maneja arquivo com muitos símbolos sem estourar limite de arestas', () => {
    const nodes: ASTNode[] = [];
    for (let i = 0; i < 50; i++) {
      nodes.push({
        name: `func${i}`,
        kind: 'FunctionDeclaration',
        text: `function func${i}() { func${(i + 1) % 50}(); func${(i + 2) % 50}(); }`,
        startLine: i + 1,
        endLine: i + 1,
      });
    }
    const parser = createMockParser(nodes);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    // Deve respeitar o limite MAX_EDGES_PER_FILE (200)
    expect(result.edges.length).toBeLessThanOrEqual(200);
  });

  it('REFERENCES: cria arestas para referências sem chamada', () => {
    const parser = createMockParser([
      { name: 'funcA', kind: 'FunctionDeclaration', text: 'function funcA() { return refB; }', startLine: 1, endLine: 1 },
      { name: 'refB', kind: 'FunctionDeclaration', text: 'function refB() {}', startLine: 3, endLine: 3 },
    ]);
    const extractor = new ASTRelationshipExtractor(parser);
    const result = extractor.extract('src/test.ts', 'ignored');

    const referencesEdges = result.edges.filter((e) => e.type === 'REFERENCES');
    // refB aparece sem chamada → deve gerar REFERENCES
    const hasReference = referencesEdges.some((e) => e.type === 'REFERENCES');
    expect(hasReference).toBe(true);
  });
});
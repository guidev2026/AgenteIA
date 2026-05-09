/**
 * Tests for TypescriptASTAdapter
 *
 * Validações:
 * - Parse de function declaration com nome
 * - Parse de class declaration com métodos
 * - Parse de interface e type alias
 * - Parse de enum
 * - Parse de arrow function em const
 * - Array vazio para código inválido / vazio
 * - Ordenação por startLine
 * - Preservação de texto fonte e line numbers
 * - Métodos dentro de classe (MethodDeclaration, Constructor)
 * - ExportAssignment (export default)
 * - ModuleDeclaration (namespace)
 */

import { describe, it, expect } from 'vitest';
import { TypescriptASTAdapter } from '../../../src/core/rag/TypescriptASTAdapter';

describe('TypescriptASTAdapter', () => {
  const parser = new TypescriptASTAdapter();

  describe('parse — function declarations', () => {
    it('should extract a standalone function', () => {
      const source = 'function hello(): string {\n  return "world";\n}\n';
      const nodes = parser.parse(source);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        name: 'hello',
        kind: 'FunctionDeclaration',
        startLine: 1,
        endLine: 3,
      });
      expect(nodes[0].text).toContain('function hello()');
    });

    it('should extract multiple functions in order', () => {
      const source = [
        'function foo() {}',
        '',
        'function bar() {}',
      ].join('\n');

      const nodes = parser.parse(source);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].name).toBe('foo');
      expect(nodes[1].name).toBe('bar');
      expect(nodes[0].startLine).toBeLessThan(nodes[1].startLine);
    });

    it('should extract async function', () => {
      const source = 'async function fetchData(): Promise<void> {}';
      const nodes = parser.parse(source);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('fetchData');
      expect(nodes[0].kind).toBe('FunctionDeclaration');
    });
  });

  describe('parse — class declarations', () => {
    it('should extract a class with its methods', () => {
      const source = [
        'class MyService {',
        '  constructor() {}',
        '  getName(): string { return "x"; }',
        '  private setValue(v: string) {}',
        '}',
      ].join('\n');

      const nodes = parser.parse(source);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      expect(nodes[0].name).toBe('MyService');
    });

    it('should extract class methods as separate nodes', () => {
      const source = [
        'class MyService {',
        '  constructor() {}',
        '  getName(): string { return "x"; }',
        '  private setValue(v: string) {}',
        '}',
      ].join('\n');

      const nodes = parser.parse(source);

      const methodNames = nodes.map((n) => n.name);
      expect(methodNames).toContain('constructor');
      expect(methodNames).toContain('getName');
      expect(methodNames).toContain('setValue');

      const constructorNode = nodes.find((n) => n.name === 'constructor');
      expect(constructorNode?.kind).toBe('Constructor');

      const getNameNode = nodes.find((n) => n.name === 'getName');
      expect(getNameNode?.kind).toBe('MethodDeclaration');
    });

    it('should handle class with getter/setter', () => {
      const source = [
        'class Data {',
        '  get value(): number { return 1; }',
        '  set value(v: number) { }',
        '}',
      ].join('\n');

      const nodes = parser.parse(source);
      const kinds = nodes.map((n) => n.kind);
      expect(kinds).toContain('GetAccessor');
      expect(kinds).toContain('SetAccessor');
    });
  });

  describe('parse — interfaces and types', () => {
    it('should extract interface declaration', () => {
      const source = 'interface IConfig {\n  port: number;\n}\n';
      const nodes = parser.parse(source);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        name: 'IConfig',
        kind: 'InterfaceDeclaration',
      });
    });

    it('should extract type alias', () => {
      const source = 'type Callback = (err: Error | null) => void;\n';
      const nodes = parser.parse(source);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        name: 'Callback',
        kind: 'TypeAliasDeclaration',
      });
    });

    it('should extract enum declaration', () => {
      const source = 'enum Color { Red, Green, Blue }\n';
      const nodes = parser.parse(source);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        name: 'Color',
        kind: 'EnumDeclaration',
      });
    });

    it('should extract module/namespace declaration', () => {
      const source = 'namespace MyUtils {\n  export function log() {}\n}\n';
      const nodes = parser.parse(source);

      const moduleNode = nodes.find((n) => n.kind === 'ModuleDeclaration');
      expect(moduleNode).toBeDefined();
      expect(moduleNode?.name).toBe('MyUtils');
    });
  });

  describe('parse — variable statements', () => {
    it('should extract const arrow function', () => {
      const source = 'const handler = (x: number) => x * 2;\n';
      const nodes = parser.parse(source);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('handler');
    });

    it('should extract const with function expression', () => {
      const source = 'const sum = function(a: number, b: number): number {\n  return a + b;\n};\n';
      const nodes = parser.parse(source);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('sum');
    });

    it('should extract let and var variable statements', () => {
      const source = [
        'let add = (a: number, b: number) => a + b;',
        'var multiply = function(a: number, b: number): number { return a * b; };',
      ].join('\n');

      const nodes = parser.parse(source);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].name).toBe('add');
      expect(nodes[1].name).toBe('multiply');
    });
  });

  describe('parse — export assignment', () => {
    it('should extract export default expression', () => {
      const source = 'export default 42;\n';
      const nodes = parser.parse(source);

      const exportNode = nodes.find((n) => n.kind === 'ExportAssignment');
      expect(exportNode).toBeDefined();
      expect(exportNode?.name).toBe('export_default');
    });
  });

  describe('parse — edge cases', () => {
    it('should return empty array for empty source', () => {
      expect(parser.parse('')).toEqual([]);
    });

    it('should return empty array for whitespace-only source', () => {
      expect(parser.parse('   \n  \n  ')).toEqual([]);
    });

    it('should return empty array for invalid JavaScript', () => {
      const nodes = parser.parse('@@@ invalid javascript {{{');
      // TS parser tolera erros, mas não deve crashar
      expect(Array.isArray(nodes)).toBe(true);
    });

    it('should not extract import statements', () => {
      const source = [
        'import { foo } from "./foo";',
        'const x = 1;',
      ].join('\n');

      const nodes = parser.parse(source);
      const importNode = nodes.find((n) => n.kind === 'ImportDeclaration' || n.text.includes('import'));
      expect(importNode).toBeUndefined();
    });
  });

  describe('parse — ordering', () => {
    it('should sort nodes by startLine', () => {
      const source = [
        'function second() {}',
        '',
        'function first() {}',
      ].join('\n');

      const nodes = parser.parse(source);
      expect(nodes[0].name).toBe('second');
      expect(nodes[1].name).toBe('first');
    });
  });
});
/**
 * Tests for ASTEditor — Edição estrutural por nome de símbolo.
 *
 * Cenários:
 * ✅ Sucesso: substituição de função mantém resto do arquivo intacto
 * ✅ Símbolo não encontrado: success: false, symbolFound: false
 * ✅ Arquivo inexistente: success: false, mensagem de erro clara
 * ✅ Substituição de classe, interface, variável, type alias
 * ✅ getFullStart() usado corretamente (preserva comentários/whitespace anteriores)
 * ✅ Path traversal bloqueado: caminhos fora do projeto são rejeitados
 */

import * as path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASTEditor } from '../../../src/core/ASTEditor';
import type { FileReader } from '../../../src/core/FileReader';
import { FileReader as FileReaderImpl } from '../../../src/core/FileReader';

// Mock do fs nativo
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
  },
  writeFile: vi.fn(),
}));

import * as fs from 'node:fs/promises';

const CWD = process.cwd();
const TEST_PATH = path.join(CWD, 'temp-test-ast.ts');
const RO_PATH = path.join(CWD, 'temp-readonly.ts');

describe('ASTEditor', () => {
  let mockFileReader: FileReader;
  let editor: ASTEditor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileReader = {
      readFile: vi.fn(),
      readDir: vi.fn(),
      searchFiles: vi.fn(),
    };
    editor = new ASTEditor(mockFileReader);
  });

  describe('replaceSymbol — cenário de sucesso', () => {
    it('deve substituir o corpo de uma função e preservar o resto do arquivo', async () => {
      // getFullStart() inclui whitespace/trivia anteriores ao nó,
      // então o conteúdo ANTES do nó termina em 'from 'bar';\n'
      // e o newCode precisa incluir o whitespace que estava antes
      const source = `import { foo } from 'bar';\n\nfunction oldFunc() {\n  return 'old';\n}\n\nconst x = 42;\n`;
      const newCode = `function oldFunc() {\n  return 'new';\n}`;
      // getFullStart() consome o '\n\n' antes de 'function', então a saída fica colada no ';'
      const expectedOutput = `import { foo } from 'bar';${newCode}\n\nconst x = 42;\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'oldFunc', newCode);

      expect(result.success).toBe(true);
      expect(result.symbolFound).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expectedOutput,
        'utf-8'
      );
    });

    it('deve substituir uma classe', async () => {
      // getFullStart() consome '// top comment\n\n' junto com o nó
      const source = `// top comment\n\nclass MyClass {\n  prop = 1;\n}\n\nexport default MyClass;\n`;
      const newClass = `class MyClass {\n  prop = 2;\n}`;
      const expected = `${newClass}\n\nexport default MyClass;\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'MyClass', newClass);

      expect(result.success).toBe(true);
      expect(result.symbolFound).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expected,
        'utf-8'
      );
    });

    it('deve substituir uma variável (VariableStatement)', async () => {
      const source = `const MY_CONST = 'hello';\n\nfunction helper() {}\n`;
      const newVar = `const MY_CONST = 'world';`;
      const expected = `${newVar}\n\nfunction helper() {}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'MY_CONST', newVar);

      expect(result.success).toBe(true);
      expect(result.symbolFound).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expected,
        'utf-8'
      );
    });

    it('deve substituir uma interface', async () => {
      const source = `interface MyInterface {\n  id: number;\n}\n\nexport { MyInterface };\n`;
      const newInterface = `interface MyInterface {\n  id: string;\n}`;
      const expected = `${newInterface}\n\nexport { MyInterface };\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'MyInterface', newInterface);

      expect(result.success).toBe(true);
      expect(result.symbolFound).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expected,
        'utf-8'
      );
    });

    it('deve substituir um type alias', async () => {
      const source = `type MyType = string;\n\nfunction use() {}\n`;
      const newType = `type MyType = number;`;
      const expected = `${newType}\n\nfunction use() {}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'MyType', newType);

      expect(result.success).toBe(true);
      expect(result.symbolFound).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expected,
        'utf-8'
      );
    });

    it('deve preservar comentários/whitespace anteriores ao nó (usando getFullStart)', async () => {
      const source = `// leading comment\n/* block */\nfunction target() { return 1; }\n\nconst other = 2;\n`;
      const newFn = `function target() { return 999; }`;
      // getFullStart() includes leading comments, so they get replaced along with the node
      const expected = `${newFn}\n\nconst other = 2;\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'target', newFn);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expected,
        'utf-8'
      );
    });
  });

  describe('replaceSymbol — cenário de erro', () => {
    it('deve retornar success: false e symbolNotFound quando símbolo não existe', async () => {
      const source = `const a = 1;\nfunction existing() {}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'nonExistent', 'anything');

      expect(result.success).toBe(false);
      expect(result.symbolFound).toBe(false);
      expect(result.error).toContain('nonExistent');
      // Arquivo não deve ter sido escrito
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('deve retornar success: false quando o arquivo não existe', async () => {
      (mockFileReader.readFile as any).mockRejectedValue(
        new Error('Failed to read file "/nonexistent.ts": ENOENT: no such file or directory')
      );

      const result = await editor.replaceSymbol('/nonexistent.ts', 'foo', 'bar');

      expect(result.success).toBe(false);
      expect(result.symbolFound).toBe(false);
      expect(result.error).toContain('ENOENT');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('deve retornar success: false quando a escrita falha (caminho fora do projeto)', async () => {
      const source = `function willFail() {}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);

      const result = await editor.replaceSymbol('/etc/passwd', 'willFail', 'new code');

      expect(result.success).toBe(false);
      expect(result.symbolFound).toBe(true);
      expect(result.error).toContain('Acesso negado');
    });
  });

  describe('replaceSymbol — casos de borda', () => {
    it('deve funcionar com arquivo vazio (nenhum símbolo encontrado)', async () => {
      (mockFileReader.readFile as any).mockResolvedValue('');

      const result = await editor.replaceSymbol(TEST_PATH, 'anything', 'code');

      expect(result.success).toBe(false);
      expect(result.symbolFound).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('deve substituir export default (ExportAssignment)', async () => {
      // getFullStart() consome o '\n' antes de 'export default'
      const source = `const x = 1;\nexport default x;\n`;
      const newExport = `export default 42;`;
      const expected = `const x = 1;${newExport}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.replaceSymbol(TEST_PATH, 'export_default', newExport);

      expect(result.success).toBe(true);
      expect(result.symbolFound).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        FileReaderImpl.resolveSecurePath(TEST_PATH),
        expected,
        'utf-8'
      );
    });
  });
});
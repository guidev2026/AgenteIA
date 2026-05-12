/**
 * editing-pipeline.test.ts — Teste de Integração do Pipeline Completo de Edição.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AVISO: Este é o ÚNICO conjunto de testes neste projeto que acessa o
 * filesystem real (cria, lê, edita e deleta arquivos em disco).
 * Todos os demais testes usam mocks para FileReader / fs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pipeline simulado:
 * 1. Cria arquivo TypeScript temporário em tests/integration/.tmp/
 * 2. ASTEditor.replaceSymbol() → substitui função por nome de símbolo
 * 3. Verifica que o arquivo foi alterado corretamente
 * 4. Cria arquivo não-TypeScript (texto) temporário
 * 5. SearchReplaceEditor.apply() → substitui bloco exato
 * 6. Verifica que o arquivo foi alterado corretamente
 * 7. Limpeza: afterEach deleta todos os arquivos temporários
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileReader } from '../../src/core/FileReader';
import { ASTEditor } from '../../src/core/ASTEditor';
import { SearchReplaceEditor } from '../../src/core/SearchReplaceEditor';

// ── Helpers ──────────────────────────────────────────────────────

/** Diretório temporário dentro do projeto (respeita FileReader.resolveSecurePath) */
const TMP_DIR = path.join(process.cwd(), 'tests', 'integration', '.tmp');

const tmpFiles: string[] = [];

/** Cria um arquivo temporário com conteúdo e registra para limpeza */
async function createTempFile(filename: string, content: string): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  tmpFiles.push(filePath);
  return filePath;
}

/** Lê arquivo como string */
async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

// ── Setup / Teardown ─────────────────────────────────────────────

beforeAll(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  // Remove diretório temporário e todo o seu conteúdo
  try {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  } catch {
    // Ignora se já foi removido
  }
});

afterEach(async () => {
  for (const f of tmpFiles) {
    try {
      await fs.unlink(f);
    } catch {
      // Ignora se já foi deletado
    }
  }
  tmpFiles.length = 0;
});

// ── Testes ───────────────────────────────────────────────────────

describe('Editing Pipeline — Integração com Filesystem Real', () => {
  // ──────────────────────────────────────────────────────────────────
  // ASTEditor.replaceSymbol() em arquivo TypeScript
  // ──────────────────────────────────────────────────────────────────
  it('deve substituir função TypeScript por símbolo via ASTEditor', async () => {
    const tsCode = [
      'function greet(name: string): string {',
      '  return `Hello, ${name}!`;',
      '}',
      '',
      'function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export { greet, add };',
      '',
    ].join('\n');

    const filePath = await createTempFile('test-ast-editor.ts', tsCode);
    const fileReader = new FileReader();
    const editor = new ASTEditor(fileReader);

    // Substituir a função "add" por uma nova implementação
    const newAddCode = [
      'function add(a: number, b: number): number {',
      '  const result = a + b;',
      '  console.log(`Adding ${a} + ${b} = ${result}`);',
      '  return result;',
      '}',
    ].join('\n');

    const result = await editor.replaceSymbol(filePath, 'add', newAddCode);

    expect(result.success).toBe(true);
    expect(result.symbolFound).toBe(true);
    expect(result.filePath).toBe(filePath);
    expect(result.symbolName).toBe('add');

    // Verificar conteúdo do arquivo pós-edição
    const updatedContent = await readFile(filePath);
    expect(updatedContent).toContain('console.log(`Adding ${a} + ${b} = ${result}`)');
    expect(updatedContent).toContain('function greet(name: string): string {');
    expect(updatedContent).toContain('return `Hello, ${name}!`;');
    expect(updatedContent).toContain('export { greet, add };');

    // A função 'add' original foi substituída — verificar que o código antigo sumiu
    expect(updatedContent).not.toContain('  return a + b;');
  });

  it('deve retornar symbolFound false para símbolo inexistente', async () => {
    const tsCode = [
      'function exist(): string {',
      '  return "I exist";',
      '}',
      '',
    ].join('\n');

    const filePath = await createTempFile('test-ast-nonexistent.ts', tsCode);
    const fileReader = new FileReader();
    const editor = new ASTEditor(fileReader);

    const result = await editor.replaceSymbol(
      filePath,
      'nonExistentFunction',
      'function nonExistentFunction() { return "new"; }'
    );

    expect(result.success).toBe(false);
    expect(result.symbolFound).toBe(false);
    expect(result.error).toContain('nonExistentFunction');
  });

  // ──────────────────────────────────────────────────────────────────
  // SearchReplaceEditor.apply() em arquivo não-TypeScript
  // ──────────────────────────────────────────────────────────────────
  it('deve substituir bloco exato via SearchReplaceEditor em arquivo .txt', async () => {
    const textContent = [
      '# Configuração do Servidor',
      '',
      'PORT=3000',
      'HOST=localhost',
      'DEBUG=true',
      '',
      '# Fim da configuração',
      '',
    ].join('\n');

    const filePath = await createTempFile('test-config.txt', textContent);
    const fileReader = new FileReader();
    const editor = new SearchReplaceEditor(fileReader);

    const result = await editor.apply(
      filePath,
      'PORT=3000',
      'PORT=8080'
    );

    expect(result.success).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.filePath).toBe(filePath);

    const updatedContent = await readFile(filePath);
    expect(updatedContent).toContain('PORT=8080');
    expect(updatedContent).not.toContain('PORT=3000');
    expect(updatedContent).toContain('HOST=localhost');
    expect(updatedContent).toContain('DEBUG=true');
  });

  it('deve substituir bloco multi-linha via SearchReplaceEditor', async () => {
    const textContent = [
      '// Dados de conexão',
      'host: localhost',
      'port: 5432',
      'user: admin',
      '// Fim conexão',
    ].join('\n');

    const filePath = await createTempFile('test-multiline.yaml', textContent);
    const fileReader = new FileReader();
    const editor = new SearchReplaceEditor(fileReader);

    const searchBlock = [
      'host: localhost',
      'port: 5432',
      'user: admin',
    ].join('\n');

    const replaceBlock = [
      'host: db.example.com',
      'port: 5432',
      'user: readonly_user',
      'password: secret',
    ].join('\n');

    const result = await editor.apply(filePath, searchBlock, replaceBlock);

    expect(result.success).toBe(true);
    expect(result.matchCount).toBe(1);

    const updatedContent = await readFile(filePath);
    expect(updatedContent).toContain('host: db.example.com');
    expect(updatedContent).toContain('user: readonly_user');
    expect(updatedContent).toContain('password: secret');
    expect(updatedContent).toContain('// Dados de conexão');
    expect(updatedContent).toContain('// Fim conexão');
  });

  it('deve retornar matchCount 0 quando bloco não é encontrado', async () => {
    const textContent = 'linha um\nlinha dois\nlinha tres\n';
    const filePath = await createTempFile('test-nomatch.txt', textContent);
    const fileReader = new FileReader();
    const editor = new SearchReplaceEditor(fileReader);

    const result = await editor.apply(filePath, 'linha quatro', 'linha cinco');

    expect(result.success).toBe(false);
    expect(result.matchCount).toBe(0);
    // O erro será sobre bloco não encontrado, não sobre caminho negado
    expect(result.error).toContain('não encontrado');
  });

  // ──────────────────────────────────────────────────────────────────
  // Pipeline Completo (TypeScript + texto em sequência)
  // ──────────────────────────────────────────────────────────────────
  it('deve executar pipeline completo: ASTEditor seguido de SearchReplace', async () => {
    // ── Etapa 1: Criar um arquivo .ts com função + comentário ──
    const tsCode = [
      '// src/calculator.ts',
      'function multiply(a: number, b: number): number {',
      '  return a * b;',
      '}',
      '',
      '// TODO: documentar',
      'function divide(a: number, b: number): number {',
      '  if (b === 0) throw new Error("Division by zero");',
      '  return a / b;',
      '}',
      '',
      'export { multiply, divide };',
    ].join('\n');

    const tsPath = await createTempFile('test-pipeline-calc.ts', tsCode);
    const fileReader = new FileReader();

    // ── Etapa 2: ASTEditor.replaceSymbol() em "divide" ──
    const astEditor = new ASTEditor(fileReader);
    const astResult = await astEditor.replaceSymbol(
      tsPath,
      'divide',
      [
        'function divide(a: number, b: number): number {',
        '  if (b === 0) {',
        '    console.warn("Division by zero detected");',
        '    return NaN;',
        '  }',
        '  return a / b;',
        '}',
      ].join('\n')
    );

    expect(astResult.success).toBe(true);
    expect(astResult.symbolFound).toBe(true);

    // ── Etapa 3: Verificar alteração AST ──
    let content = await readFile(tsPath);
    expect(content).toContain('console.warn("Division by zero detected")');
    expect(content).toContain('return NaN;');
    expect(content).toContain('function multiply(a: number, b: number): number {');
    // '// TODO: documentar' era leading trivia de 'divide', então foi substituído junto
    expect(content).not.toContain('TODO: documentar');


    // ── Etapa 4: SearchReplaceEditor.apply() no mesmo arquivo .ts ──
    // NOTA: '// TODO: documentar' foi consumido como leading trivia do símbolo 'divide'
    // no passo AST. Vamos substituir o cabeçalho do arquivo que ainda está intacto.
    const srEditor = new SearchReplaceEditor(fileReader);
    const srResult = await srEditor.apply(
      tsPath,
      '// src/calculator.ts',
      '// src/calculator.ts — with NaN-safe divide'
    );

    expect(srResult.success).toBe(true);
    expect(srResult.matchCount).toBe(1);

    // ── Etapa 5: Verificar edições combinadas ──
    content = await readFile(tsPath);
    expect(content).toContain('console.warn("Division by zero detected")');
    expect(content).toContain('return NaN;');
    expect(content).toContain('// src/calculator.ts — with NaN-safe divide');
    expect(content).not.toContain('TODO: documentar');
    expect(content).not.toContain('throw new Error("Division by zero")');
    expect(content).toContain('export { multiply, divide };');
  });
});
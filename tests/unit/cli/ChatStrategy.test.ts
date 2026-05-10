/**
 * ChatStrategy.test.ts — Testes para buildSystemPrompt()
 *
 * Cobertura:
 * - Bloco de workflow de edição aparece quando tools de edição estão registradas
 * - Bloco NÃO aparece sem as tools
 * - Bloco tem no máximo 15 linhas
 */

import { describe, it, expect, vi } from 'vitest';
import { buildSystemPrompt } from '../../../src/cli/strategies/ChatStrategy';
import type { AppContext } from '../../../src/core/AppContext';

// ── Factories ────────────────────────────────────────────────────

function makeToolRegistry(toolNames: string[]) {
  return {
    getDefinitions: () => JSON.stringify(toolNames.map((name) => ({
      type: 'function',
      function: { name, description: '', parameters: { type: 'object', properties: {}, required: [] } },
    })), null, 2),
    getToolNames: () => [...toolNames],
    hasTool: (name: string) => toolNames.includes(name),
    execute: vi.fn(),
  };
}

function makeMockApp(toolRegistry: ReturnType<typeof makeToolRegistry>): AppContext {
  return {
    toolRegistry: toolRegistry as any,
    fileReader: {} as any,
    embedProvider: undefined,
    commandExecutor: {} as any,
    config: { provider: 'ollama', model: 'test' },
    llmProvider: {} as any,
    provider: {} as any,
    sessionManager: {} as any,
    getTools: vi.fn() as any,
  } as unknown as AppContext;
}

// ── Testes ───────────────────────────────────────────────────────

describe('ChatStrategy — buildSystemPrompt', () => {
  it('deve incluir bloco de workflow quando editSymbol está registrada', async () => {
    const toolRegistry = makeToolRegistry(['readFile', 'editSymbol', 'executeCommand']);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    expect(prompt).toContain('WORKFLOW DE EDIÇÃO:');
    expect(prompt).toContain('NUNCA reescreva um arquivo inteiro');
    expect(prompt).toContain('readFileForEdit');
    expect(prompt).toContain('editSymbol');
    expect(prompt).toContain('searchReplace');
    expect(prompt).toContain('BLOCK_NOT_FOUND');
  });

  it('deve incluir bloco de workflow quando searchReplace está registrada', async () => {
    const toolRegistry = makeToolRegistry(['readFile', 'searchReplace', 'executeCommand']);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    expect(prompt).toContain('WORKFLOW DE EDIÇÃO:');
  });

  it('deve incluir bloco quando ambas as tools de edição estão registradas', async () => {
    const toolRegistry = makeToolRegistry(['editSymbol', 'searchReplace', 'readFile']);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    expect(prompt).toContain('WORKFLOW DE EDIÇÃO:');
  });

  it('NÃO deve incluir bloco de workflow sem tools de edição', async () => {
    const toolRegistry = makeToolRegistry(['readFile', 'executeCommand']);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    expect(prompt).not.toContain('WORKFLOW DE EDIÇÃO:');
    expect(prompt).not.toContain('NUNCA reescreva');
  });

  it('NÃO deve incluir bloco com toolRegistry vazio', async () => {
    const toolRegistry = makeToolRegistry([]);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    expect(prompt).not.toContain('WORKFLOW DE EDIÇÃO:');
  });

  it('bloco de workflow deve ter no máximo 15 linhas', async () => {
    const toolRegistry = makeToolRegistry(['editSymbol', 'searchReplace']);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    // Extrai o bloco de workflow
    const workflowMatch = prompt.match(/WORKFLOW DE EDIÇÃO:[\s\S]*?(?=\n{2,}|$)/);
    if (workflowMatch) {
      const lines = workflowMatch[0].split('\n').filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(15);
    }
  });

  it('deve continuar funcionando sem RAG (regressão)', async () => {
    const toolRegistry = makeToolRegistry([]);
    const app = makeMockApp(toolRegistry);

    const prompt = await buildSystemPrompt(app, 'teste', false);

    expect(prompt).toContain('Ferramentas disponíveis');
    expect(prompt).toContain('teste');
    expect(prompt).toContain('assistente');
  });
});
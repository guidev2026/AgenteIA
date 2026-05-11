/**
 * ASTRelationshipExtractor: Extrai relações semânticas do código fonte via AST.
 *
 * Responsabilidade Única (SRP):
 * - Consumir IASTParser (já existente) para obter ASTNode[]
 * - Detectar CALLS, IMPORTS, EXTENDS, IMPLEMENTS, CONTAINS, BELONGS_TO
 * - Gerar GraphNode para cada símbolo
 * - Gerar GraphEdge para cada relação descoberta
 *
 * DIP: Depende de IASTParser (abstração), não de TypescriptASTAdapter (concreto).
 *
 * Validações:
 * - Ignora chamadas a built-ins (console, process, require, import)
 * - Ignora auto-referências
 * - Limite de 200 arestas por arquivo
 */

import type { IASTParser } from '../IASTParser';
import type { IRelationshipExtractor, ExtractionResult } from './IRelationshipExtractor';
import type { GraphNode, GraphEdge } from './types';
import { hashId } from './JsonGraphStore';
import type { IChunker } from '../IChunker';

// Built-ins do Node.js/JS que não devem gerar arestas
const BUILTINS = new Set([
  'console', 'process', 'require', 'import', 'export',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'Promise', 'Math', 'JSON', 'Array', 'Object', 'String',
  'Number', 'Boolean', 'Date', 'RegExp', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'Buffer', 'globalThis',
]);

// Extensões suportadas para extração
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

const MAX_EDGES_PER_FILE = 200;

export class ASTRelationshipExtractor implements IRelationshipExtractor {
  private readonly astParser: IASTParser;
  private readonly chunkIdMapper?: IChunker;

  constructor(astParser: IASTParser, chunkIdMapper?: IChunker) {
    this.astParser = astParser;
    this.chunkIdMapper = chunkIdMapper;
  }

  extract(filePath: string, source: string): ExtractionResult {
    // Valida se o arquivo é suportado
    if (!this.isSupportedFile(filePath)) {
      return { nodes: [], edges: [] };
    }

    // Se código vazio, retorna vazio
    if (!source || source.trim().length === 0) {
      return { nodes: [], edges: [] };
    }

    const astNodes = this.astParser.parse(source);

    // Se não conseguiu parsear, retorna vazio
    if (astNodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let edgeCount = 0;

    // 1. Nó do arquivo
    const fileNodeId = hashId(filePath);
    nodes.push({
      id: fileNodeId,
      label: filePath.split('/').pop() ?? filePath,
      type: 'file',
      filePath,
      startLine: 1,
      endLine: source.split('\n').length,
    });

    // 2. Nós dos símbolos (funções, classes, métodos, interfaces)
    const symbolNodes: Map<string, GraphNode> = new Map();

    // Pré-calcula chunkIds se chunkIdMapper estiver disponível
    let chunkIdByLine: Map<number, string> | undefined;
    if (this.chunkIdMapper) {
      chunkIdByLine = this.buildChunkIdMap(source, filePath);
    }

    for (let i = 0; i < astNodes.length; i++) {
      const astNode = astNodes[i];
      const nodeType = this.mapKindToType(astNode.kind);
      const id = hashId(`${filePath}#${astNode.kind}#${astNode.name}`);

      // Determina chunkId: se temos o mapeamento, usa a startLine do símbolo
      let chunkId: string | undefined;
      if (chunkIdByLine) {
        // Procura o chunk que contém a startLine do símbolo
        chunkId = this.findChunkIdForLine(chunkIdByLine, astNode.startLine);
      }
      // Fallback: usa o índice do nó como parte do chunkId (formato: path#indice)
      if (!chunkId) {
        chunkId = `${filePath}#${i}`;
      }

      const graphNode: GraphNode = {
        id,
        label: astNode.name,
        type: nodeType,
        chunkId,
        filePath,
        startLine: astNode.startLine,
        endLine: astNode.endLine,
      };

      symbolNodes.set(id, graphNode);
      nodes.push(graphNode);

      // Aresta BELONGS_TO: símbolo → arquivo
      if (edgeCount < MAX_EDGES_PER_FILE) {
        edges.push({
          from: id,
          to: fileNodeId,
          type: 'BELONGS_TO',
          metadata: { line: astNode.startLine },
        });
        edgeCount++;
      }

      // Aresta CONTAINS: arquivo → símbolo (inverso)
      if (edgeCount < MAX_EDGES_PER_FILE) {
        edges.push({
          from: fileNodeId,
          to: id,
          type: 'CONTAINS',
          metadata: { line: astNode.startLine },
        });
        edgeCount++;
      }
    }

    // 3. Extrair relações a partir do texto de cada nó
    const allNames = new Set(astNodes.map((n) => n.name));
    const allNodeIdsByName = new Map<string, string>();
    for (const astNode of astNodes) {
      const id = hashId(`${filePath}#${astNode.kind}#${astNode.name}`);
      allNodeIdsByName.set(astNode.name, id);
    }

    // CALLS: detectar chamadas de função
    if (edgeCount < MAX_EDGES_PER_FILE) {
      for (const astNode of astNodes) {
        const sourceId = hashId(`${filePath}#${astNode.kind}#${astNode.name}`);
        const callMatches = astNode.text.matchAll(/\b([A-Za-z_$][\w$.]*)\s*\(/g);

        for (const match of callMatches) {
          if (edgeCount >= MAX_EDGES_PER_FILE) break;

          const calleeName = match[1];
          const dotIndex = calleeName.lastIndexOf('.');
          const simpleName = dotIndex !== -1 ? calleeName.slice(dotIndex + 1) : calleeName;

          // Ignorar built-ins
          if (BUILTINS.has(simpleName)) continue;

          // Ignorar auto-chamadas
          if (simpleName === astNode.name) continue;

          // Verificar se a chamada é para um símbolo conhecido no mesmo arquivo
          if (allNames.has(simpleName)) {
            const targetId = allNodeIdsByName.get(simpleName)!;

            // Não criar aresta para si mesmo
            if (targetId === sourceId) continue;

            edges.push({
              from: sourceId,
              to: targetId,
              type: 'CALLS',
              metadata: { line: astNode.startLine },
            });
            edgeCount++;
          } else if (simpleName.includes('.') || simpleName === simpleName.toLowerCase()) {
            // Método de objeto (ex: this.save()) ou lib nativa — ignorar
            continue;
          }
        }
      }
    }

    // IMPORTS: extrair importações
    if (edgeCount < MAX_EDGES_PER_FILE) {
      const importMatches = source.matchAll(
        /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
      );

      for (const match of importMatches) {
        if (edgeCount >= MAX_EDGES_PER_FILE) break;

        const modulePath = match[1] ?? match[2];
        if (!modulePath) continue;

        // Ignorar módulos core do Node
        if (modulePath.startsWith('node:') || BUILTINS.has(modulePath)) continue;

        const moduleName = modulePath.split('/').pop() ?? modulePath;
        const moduleId = hashId(`module:${modulePath}`);

        // Criar nó para o módulo (se não existir)
        if (!symbolNodes.has(moduleId)) {
          nodes.push({
            id: moduleId,
            label: moduleName,
            type: 'file',
            filePath: modulePath,
            startLine: 1,
            endLine: 1,
          });
          symbolNodes.set(moduleId, {
            id: moduleId,
            label: moduleName,
            type: 'file',
            filePath: modulePath,
            startLine: 1,
            endLine: 1,
          });
        }

        edges.push({
          from: fileNodeId,
          to: moduleId,
          type: 'IMPORTS',
          metadata: { modulePath },
        });
        edgeCount++;
      }
    }

    // EXTENDS: herança de classe
    if (edgeCount < MAX_EDGES_PER_FILE) {
      for (const astNode of astNodes) {
        if (astNode.kind !== 'ClassDeclaration') continue;

        const sourceId = hashId(`${filePath}#${astNode.kind}#${astNode.name}`);
        const extendsMatch = astNode.text.match(/extends\s+(\w+)/);

        if (extendsMatch) {
          const parentName = extendsMatch[1];
          if (allNames.has(parentName)) {
            const targetId = allNodeIdsByName.get(parentName)!;
            if (targetId !== sourceId) {
              edges.push({
                from: sourceId,
                to: targetId,
                type: 'EXTENDS',
                metadata: { line: astNode.startLine },
              });
              edgeCount++;
            }
          }
        }
      }
    }

    // IMPLEMENTS: implementação de interface
    if (edgeCount < MAX_EDGES_PER_FILE) {
      for (const astNode of astNodes) {
        if (astNode.kind !== 'ClassDeclaration') continue;

        const sourceId = hashId(`${filePath}#${astNode.kind}#${astNode.name}`);
        const implementsMatch = astNode.text.match(/implements\s+([\w,\s]+)/);

        if (implementsMatch) {
          const interfaceNames = implementsMatch[1].split(',').map((s) => s.trim());
          for (const ifaceName of interfaceNames) {
            if (edgeCount >= MAX_EDGES_PER_FILE) break;
            if (allNames.has(ifaceName)) {
              const targetId = allNodeIdsByName.get(ifaceName)!;
              if (targetId !== sourceId) {
                edges.push({
                  from: sourceId,
                  to: targetId,
                  type: 'IMPLEMENTS',
                  metadata: { line: astNode.startLine },
                });
                edgeCount++;
              }
            }
          }
        }
      }
    }

    // REFERENCES: referências a símbolos sem chamada explícita
    if (edgeCount < MAX_EDGES_PER_FILE) {
      for (const astNode of astNodes) {
        const sourceId = hashId(`${filePath}#${astNode.kind}#${astNode.name}`);

        for (const [name, targetId] of allNodeIdsByName) {
          if (edgeCount >= MAX_EDGES_PER_FILE) break;

          // Pular auto-referência
          if (targetId === sourceId) continue;

          // Verificar se o nome aparece no texto do nó (excluindo chamadas já detectadas)
          const nameRegex = new RegExp(`\\b${name}\\b`, 'g');
          const matches = astNode.text.matchAll(nameRegex);
          const positions: number[] = [];

          for (const m of matches) {
            // Verificar se não é uma chamada (já coberta por CALLS)
            const afterMatch = astNode.text[m.index! + name.length] ?? '';
            if (afterMatch !== '(') {
              positions.push(m.index!);
            }
          }

          for (const _pos of positions) {
            if (edgeCount >= MAX_EDGES_PER_FILE) break;

            // Verificar se já existe aresta CALLS entre os mesmos nós
            const hasCalls = edges.some(
              (e) => e.from === sourceId && e.to === targetId && e.type === 'CALLS'
            );
            if (!hasCalls) {
              edges.push({
                from: sourceId,
                to: targetId,
                type: 'REFERENCES',
                metadata: { line: astNode.startLine },
              });
              edgeCount++;
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Verifica se a extensão do arquivo é suportada para extração.
   */
  private isSupportedFile(filePath: string): boolean {
    const dotIndex = filePath.lastIndexOf('.');
    if (dotIndex === -1) return false;
    const ext = filePath.slice(dotIndex).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Mapeia kind do AST para tipo do GraphNode.
   */
  private mapKindToType(kind: string): GraphNode['type'] {
    switch (kind) {
      case 'FunctionDeclaration':
        return 'function';
      case 'MethodDeclaration':
        return 'method';
      case 'ClassDeclaration':
        return 'class';
      case 'InterfaceDeclaration':
        return 'interface';
      default:
        return 'function';
    }
  }

  /**
   * Constrói um mapa de linha inicial → chunkId usando o chunkIdMapper (IChunker).
   * Útil para que os GraphNode tenham chunkId preenchido, populando nodesByChunkId.
   */
  private buildChunkIdMap(source: string, filePath: string): Map<number, string> {
    const map = new Map<number, string>();
    if (!this.chunkIdMapper) return map;

    const chunks = this.chunkIdMapper.chunk(source, filePath);
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const chunkId = `${filePath}#${ci}`;
      // Mapeia cada linha do chunk para o chunkId
      for (let line = chunk.startLine; line <= chunk.endLine; line++) {
        map.set(line, chunkId);
      }
    }
    return map;
  }

  /**
   * Encontra o chunkId que contém uma determinada linha.
   * Busca exata primeiro, depois a linha mais próxima anterior.
   */
  private findChunkIdForLine(chunkIdByLine: Map<number, string>, line: number): string | undefined {
    const exact = chunkIdByLine.get(line);
    if (exact) return exact;

    // Fallback: encontra a linha anterior mais próxima que tem chunkId
    let candidate: number | undefined;
    for (const [l, id] of chunkIdByLine) {
      if (l < line && (candidate === undefined || l > candidate)) {
        candidate = l;
      }
    }
    return candidate !== undefined ? chunkIdByLine.get(candidate) : undefined;
  }
}

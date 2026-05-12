/**
 * Core module index — barrel file que expõe toda a API pública do core.
 *
 * Separação clara entre:
 * - Utilitários base (FileReader, CommandExecutor, ToolRegistry)
 * - Fábrica de providers (ProviderFactory)
 * - Pipeline RAG (RAGManager, Chunker, Embedder, VectorStore, Retriever)
 * - Loop ReAct + PromptBuilder (ReActLoop, PromptBuilder)
 * - Validação JSON (JsonValidator)
 */

// Utilitários base
export { FileReader } from './FileReader';
export type { SearchResult } from './FileReader';
export { CommandExecutor } from './CommandExecutor';
export type { CommandResult } from './CommandExecutor';
export { ToolRegistry } from './ToolRegistry';
export type { ToolDefinition } from './ToolRegistry';
export { TokenEstimator, DEFAULT_CONTEXT_WINDOWS } from './TokenEstimator';

// Context Compressor (ISP + DIP)
export type { IContextCompressor, CompressedContext } from './IContextCompressor';
export { CompressionTrigger, assessCompressionNeed } from './IContextCompressor';
export { StatefulCompressor } from './StatefulCompressor';

// Fábrica de providers (OCP)
export { ProviderFactory } from './ProviderFactory';
export type { ProviderConfig, ProviderType } from './ProviderFactory';

// Container de injeção de dependência (DIP)
export { AppContext } from './AppContext';
export type { AppContextConfig } from './AppContext';

// Pipeline RAG
export { RAGManager } from './rag/RAGManager';
export { Chunker } from './rag/Chunker';
export type { ChunkResult } from './rag/IChunker';
export { Embedder } from './rag/Embedder';
export { VectorStore } from './rag/VectorStore';
export type { ChunkEntry } from './rag/VectorStore';
export { Retriever, cosineSimilarity } from './rag/Retriever';
export type { SearchMatch } from './rag/Retriever';

// ReAct Loop + Prompt Builder (Strategy pattern)
export { ReActLoop } from './rag/ReActLoop';
export type { ReActMessage, ReActResult, LogPayload, ExecuteOptions } from './rag/ReActLoop';
// Reflector (self-correction)
export { Reflector } from './Reflector';
export type { ReflectionError, ReflectionResult } from './Reflector';

// ErrorJournal (persistência de erros de reflexão)
export { ErrorJournal } from './ErrorJournal';
export type { ErrorJournalEntry, ErrorJournalData } from './ErrorJournal';

// Session Store (Memória Episódica / Multi-turn)
export { SessionStore } from './SessionStore';
export type { Session, SessionSummary, ISessionStore } from './SessionStore';

// Session Manager (orquestração de sessão ativa)
export { SessionManager } from './SessionManager';

// AST Editor (edição estrutural de código)
export { ASTEditor } from './ASTEditor';
export type { ASTEditResult } from './ASTEditor';

// SearchReplace Editor (edição por bloco exato)
export { SearchReplaceEditor } from './SearchReplaceEditor';
export type { SearchReplaceResult } from './SearchReplaceEditor';

// Validação JSON
export { JsonValidator, ValidationError } from '../validation/JsonValidator';

/**
 * Root barrel file for @soberano/core package.
 *
 * Re-exports everything from src/core/index.ts so that
 * `import { AppContext, ReActLoop, ... } from '@soberano/core'`
 * resolves correctly to dist/index.js (as declared in package.json).
 */
export * from './core/index';
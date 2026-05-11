import React, { useState } from 'react';

/**
 * App component — Main entry point for the Electron Shell.
 *
 * This component imports types from @soberano/core to demonstrate
 * cross-package dependency within the monorepo.
 */
import type { AppContextConfig } from '@soberano/core';

const App: React.FC = () => {
  const [message, setMessage] = useState<string>('Soberano-Core Agent IA');

  // Verify core type import works
  const _config: AppContextConfig = {
    provider: { type: 'ollama', host: 'localhost', port: 11434 },
    model: 'llama3.2:1b',
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#0a0a0a',
      color: '#e0e0e0',
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
        🛡️ {message}
      </h1>
      <p style={{ color: '#888', fontSize: '0.9rem' }}>
        Electron + Vite + React + TypeScript
      </p>
      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
        <span style={{
          padding: '0.25rem 0.75rem',
          borderRadius: '4px',
          background: '#1a1a2e',
          color: '#4fc3f7',
          fontSize: '0.8rem',
        }}>
          packages/core
        </span>
        <span style={{
          padding: '0.25rem 0.75rem',
          borderRadius: '4px',
          background: '#1a2e1a',
          color: '#66bb6a',
          fontSize: '0.8rem',
        }}>
          packages/shell
        </span>
      </div>
    </div>
  );
};

export default App;
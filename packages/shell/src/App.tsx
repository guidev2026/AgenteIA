import React, { useState } from 'react';

/**
 * App component — Main entry point for the Electron Shell.
 *
 * This component implements the IPC Bridge (Ponte de Soberania):
 * - Sends prompts to the main process via window.api.askSoberano
 * - Displays the response from the Node.js backend
 */
const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setResponse('');

    try {
      const result = await window.api.askSoberano(prompt);
      setResponse(result);
    } catch (err) {
      setResponse(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
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
      padding: '2rem',
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
        🛡️ Soberano-Core
      </h1>
      <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Ponte de Soberania (IPC Bridge) — Electron + React + TypeScript
      </p>

      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '2rem',
        width: '100%',
        maxWidth: '500px',
      }}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Digite sua mensagem..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            border: '1px solid #333',
            backgroundColor: '#1a1a2e',
            color: '#e0e0e0',
            fontSize: '1rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: loading ? '#444' : '#4fc3f7',
            color: '#0a0a0a',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {loading ? 'Enviando...' : 'Enviar'}
        </button>
      </form>

      {response && (
        <div style={{
          padding: '1rem 1.5rem',
          borderRadius: '8px',
          background: '#1a1a2e',
          border: '1px solid #333',
          maxWidth: '500px',
          width: '100%',
          wordBreak: 'break-word',
        }}>
          <p style={{ color: '#4fc3f7', fontSize: '0.8rem', marginBottom: '0.5rem', fontWeight: 600 }}>
            Resposta do Core:
          </p>
          <p style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
            {response}
          </p>
        </div>
      )}
    </div>
  );
};

export default App;
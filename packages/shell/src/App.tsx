import React, { useState, useEffect, useRef } from 'react';
import type { LogPayload } from './vite-env';

/**
 * App — Interface principal do Soberano-Core.
 *
 * Layout Task 1.2.1:
 * ┌──────────────────────────────────────┐
 * │  🛡️ Header                          │
 * ├──────────────────────────────────────┤
 * │  💬 Área de Chat (resposta final)    │
 * ├──────────────────────────────────────┤
 * │  🖥️ CONSOLE DE RACIOCÍNIO (200px)   │
 * ├──────────────────────────────────────┤
 * │  ⌨️ Input Form (fixo no rodapé)     │
 * └──────────────────────────────────────┘
 */
const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogPayload[]>([]);

  // Ref para auto-scroll do terminal de logs
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Registra listener de logs ao montar o componente
  useEffect(() => {
    // Limpa logs da sessão anterior ao montar
    setLogs([]);

    const cleanup = window.api.onSoberanoLog((payload: LogPayload) => {
      // Append no array de logs
      setLogs((prev) => {
        const updated = [...prev, payload];
        return updated;
      });

      // Auto-scroll no próximo ciclo (animação suave)
      requestAnimationFrame(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Cleanup ao desmontar: remove o listener IPC
    return cleanup;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setResponse('');
    setLogs([]);

    try {
      const result = await window.api.askSoberano(prompt);
      setResponse(result);
    } catch (err) {
      setResponse(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Retorna a cor da mensagem conforme o nível do log.
   * INFO  → verde (#4ec9b0) / branco
   * WARN  → amarelo (#dcdcaa)
   * ERROR → vermelho (#f44747)
   * DEBUG → cinza claro (#808080)
   */
  const getLogColor = (level: LogPayload['level']): string => {
    switch (level) {
      case 'info':
        return '#4ec9b0';   // verde terminal
      case 'warn':
        return '#dcdcaa';   // amarelo
      case 'error':
        return '#f44747';   // vermelho
      case 'debug':
        return '#808080';   // cinza
      default:
        return '#e0e0e0';
    }
  };

  /**
   * Formata o timestamp ISO para HH:MM:SS.mmm
   */
  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  // Layout principal: tudo ocupa viewport com flex column
  // Áreas: Header (auto) → Chat (flex:1) → Console (200px fixo) → Input (auto)
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      backgroundColor: '#0a0a0a',
      color: '#e0e0e0',
    }}>
      {/* ── Header ── */}
      <header style={{
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid #222',
        textAlign: 'center',
        userSelect: 'none',
      }}>
        <h1 style={{
          fontSize: '1.25rem',
          margin: 0,
          color: '#4ec9b0',
          letterSpacing: '0.05em',
        }}>
          🛡️ Soberano-Core
        </h1>
        <p style={{
          color: '#555',
          fontSize: '0.7rem',
          margin: '0.15rem 0 0',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          Soberano Console — IPC Bridge ativa
        </p>
      </header>

      {/* ── Área de Chat (resposta final) — ocupa espaço flexível ── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem 1.5rem',
        backgroundColor: '#0d0d0d',
        borderBottom: '1px solid #1a1a1a',
      }}>
        {/* Resposta Final */}
        {response ? (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: '4px',
            background: '#1a1a2e',
            border: '1px solid #4ec9b0',
          }}>
            <p style={{
              color: '#4ec9b0',
              fontSize: '0.75rem',
              marginBottom: '0.35rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              ✅ Resposta Final
            </p>
            <p style={{
              color: '#e0e0e0',
              fontSize: '0.9rem',
              margin: 0,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}>
              {response}
            </p>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#555',
            fontStyle: 'italic',
            fontSize: '0.85rem',
          }}>
            {loading
              ? '⏳ Aguardando resposta do Soberano...'
              : '💬 Envie uma mensagem para o Soberano'
            }
          </div>
        )}
      </div>

      {/* ── CONSOLE DE RACIOCÍNIO (REACT ENGINE) — 200px fixo ── */}
      <div style={{
        height: '200px',
        borderTop: '2px solid #333',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1e1e1e',
      }}>
        {/* Label do terminal */}
        <div style={{
          padding: '4px 12px',
          fontSize: '10px',
          color: '#aaa',
          backgroundColor: '#2d2d2d',
          borderBottom: '1px solid #333',
          userSelect: 'none',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          CONSOLE DE RACIOCÍNIO (REACT ENGINE)
        </div>

        {/* Corpo do terminal com scroll */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: '12px',
          lineHeight: 1.5,
        }}>
          {/* Placeholder quando não há logs */}
          {logs.length === 0 && (
            <p style={{
              color: '#555',
              textAlign: 'center',
              marginTop: '1rem',
              fontStyle: 'italic',
            }}>
              {loading
                ? '⏳ Aguardando logs do motor Soberano...'
                : '💤 Nenhum log ainda. Envie uma mensagem para começar.'
              }
            </p>
          )}

          {/* Renderização das linhas de log */}
          {logs.map((log, index) => (
            <div
              key={index}
              style={{
                padding: '0.15rem 0',
                color: getLogColor(log.level),
                wordBreak: 'break-word',
              }}
            >
              {/* Timestamp (cinza escuro) */}
              <span style={{ color: '#666', marginRight: '0.75rem' }}>
                [{formatTime(log.timestamp)}]
              </span>

              {/* Nível (abreviado + cor) */}
              <span style={{
                display: 'inline-block',
                width: '3rem',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: getLogColor(log.level),
                marginRight: '0.5rem',
              }}>
                {log.level === 'info'
                  ? 'INFO'
                  : log.level === 'warn'
                  ? 'WARN'
                  : log.level === 'error'
                  ? 'ERR '
                  : 'DBUG'
                }
              </span>

              {/* Iteração */}
              <span style={{ color: '#808080', marginRight: '0.5rem' }}>
                [{log.iteration}]
              </span>

              {/* Mensagem principal */}
              <span>{log.message}</span>

              {/* Nome da ferramenta (quando presente) */}
              {log.data?.toolName != null && (
                <span style={{
                  color: '#569cd6',
                  marginLeft: '0.5rem',
                  fontSize: '0.75rem',
                }}>
                  → {String(log.data.toolName)}
                </span>
              )}
            </div>
          ))}

          {/* âncora para auto-scroll */}
          <div ref={consoleEndRef} />
        </div>
      </div>

      {/* ── Input Form (fixo no rodapé) ── */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '20px',
          display: 'flex',
          gap: '10px',
          backgroundColor: '#252526',
          borderTop: '1px solid #333',
        }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex: Leia o package.json na pasta ~/Documentos/estudos/AgenteIA/"
          disabled={loading}
          style={{
            flex: 1,
            padding: '12px',
            backgroundColor: '#3c3c3c',
            color: '#fff',
            border: '1px solid #444',
            borderRadius: '4px',
            fontSize: '0.9rem',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{
            padding: '10px 25px',
            backgroundColor: loading ? '#333' : '#007acc',
            color: loading ? '#666' : '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
            fontWeight: 700,
            fontFamily: 'inherit',
            transition: 'background-color 0.15s',
          }}
        >
          {loading ? '⏳ Processando...' : '▶ Enviar'}
        </button>
      </form>
    </div>
  );
};

export default App;
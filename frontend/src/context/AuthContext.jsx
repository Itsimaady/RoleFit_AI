import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const [sessionEndedReason, setSessionEndedReason] = useState(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get('/api/auth/me', { signal: controller.signal, silent401: true })
      .then((d) => {
        setUser(d.user);
        setSessionExpiresAt(d.sessionExpiresAt || null);
        setStatus('authenticated');
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setUser(null);
        setStatus('anonymous');
      });
    return () => controller.abort();
  }, []);

  // Any 401 from an authenticated call means the session ended (expired or revoked).
  useEffect(
    () =>
      onUnauthorized((err) => {
        setUser((current) => {
          if (current) setSessionEndedReason(err.code === 'session_expired' ? 'Your session expired. Please sign in again.' : 'Please sign in to continue.');
          return null;
        });
        setStatus('anonymous');
      }),
    [],
  );

  const login = useCallback(async (credentials) => {
    const d = await api.post('/api/auth/login', credentials, { silent401: true });
    setUser(d.user);
    setSessionExpiresAt(d.sessionExpiresAt || null);
    setStatus('authenticated');
    setSessionEndedReason(null);
    return d.user;
  }, []);

  const register = useCallback(async (data) => {
    const d = await api.post('/api/auth/register', data);
    setUser(d.user);
    setSessionExpiresAt(d.sessionExpiresAt || null);
    setStatus('authenticated');
    setSessionEndedReason(null);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout, setUser, sessionExpiresAt, sessionEndedReason, clearSessionEnded: () => setSessionEndedReason(null) }),
    [user, status, login, register, logout, sessionExpiresAt, sessionEndedReason],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

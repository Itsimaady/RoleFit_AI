import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Loads JSON from a GET endpoint. Each request is aborted when the path
 * changes or the component unmounts, and an incrementing request id ensures
 * a slow, older response can never overwrite newer state.
 */
export function useApiData(path, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path && enabled) });
  const requestId = useRef(0);
  const controllerRef = useRef(null);

  const load = useCallback(() => {
    if (!path || !enabled) return undefined;
    const id = ++requestId.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get(path, { signal: controller.signal })
      .then((data) => {
        if (id === requestId.current) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || id !== requestId.current) return;
        setState((s) => ({ ...s, error, loading: false }));
      });
    return controller;
  }, [path, enabled]);

  useEffect(() => {
    const controller = load();
    return () => controller?.abort();
  }, [load]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);

  return { ...state, reload: load, setData };
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const POLL_MS = 5000;
const TIMEOUT_MS = 4000;

/** Consulta `url` cada 5 s. Devuelve null ante cualquier fallo. */
export function usePolling<T>(url: string, parse: (raw: unknown) => T | null): T | null {
  const [state, setState] = useState<{ url: string; data: T | null }>({ url, data: null });

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;

    async function load() {
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let data: T | null = null;
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (res.ok) data = parse(await res.json());
      } catch {
        data = null;
      } finally {
        clearTimeout(timer);
      }
      if (alive && controller === ctrl) setState({ url, data });
    }

    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      controller?.abort();
    };
  }, [url, parse]);

  return state.url === url ? state.data : null;
}

let clock = 0;

function subscribeClock(cb: () => void): () => void {
  clock = Date.now();
  const id = setInterval(() => {
    clock = Date.now();
    cb();
  }, 1000);
  return () => clearInterval(id);
}

/** Hora del navegador (ms), actualizada cada segundo. null en el servidor. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => clock,
    () => null,
  );
}

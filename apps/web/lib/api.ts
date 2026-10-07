/** Client-side API helper. All calls go through the same-origin proxy /api/* (see next.config.ts). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: unknown) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: init.body !== undefined && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
    credentials: 'include',
    signal: init.signal,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const code = (data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : res.statusText) || 'ERROR';
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

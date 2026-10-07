import 'server-only';
import { cookies } from 'next/headers';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side API call (RSC / route handlers). Forwards the user's cookies. Returns null on 404. */
export async function serverApi<T>(path: string, init: { revalidate?: number | false; method?: string; body?: unknown } = {}): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { cookie: cookieHeader, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: init.revalidate === undefined ? 'no-store' : undefined,
    next: init.revalidate !== undefined && init.revalidate !== false ? { revalidate: init.revalidate } : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return (await res.json()) as T;
}

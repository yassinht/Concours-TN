/** Collects warnings and counters while seeding; never throws. */
export class SeedLog {
  readonly warnings: string[] = [];
  private readonly counters = new Map<string, number>();

  warn(ctx: string, msg: string): void {
    const line = `${ctx}: ${msg}`;
    this.warnings.push(line);
    console.warn(`  [warn] ${line}`);
  }

  info(msg: string): void {
    console.log(`  ${msg}`);
  }

  inc(name: string, n = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  entries(): [string, number][] {
    return [...this.counters.entries()];
  }

  /** Returns a warn function bound to a context label (handy for normalizers). */
  scoped(ctx: string): (msg: string) => void {
    return (msg) => this.warn(ctx, msg);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause;
    const detail = cause instanceof Error ? ` (${cause.message})` : '';
    return `${e.message.split('\n')[0].slice(0, 300)}${detail}`;
  }
  return String(e).slice(0, 300);
}

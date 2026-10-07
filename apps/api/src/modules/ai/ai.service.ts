import { Injectable } from '@nestjs/common';

/**
 * CONTRACT (owned by the ai module) — thin wrapper over the Anthropic Messages API (@anthropic-ai/sdk).
 * - enabled → true when ANTHROPIC_API_KEY is set. All callers MUST have a deterministic fallback when disabled.
 * - json<T>({ model, system, prompt, maxTokens, schemaHint }) → asks for JSON output, parses & returns { data, model, tokensIn, tokensOut }.
 *   Throws on API/parse failure (callers catch and fall back).
 */
@Injectable()
export class AiService {
  get enabled(): boolean {
    return false;
  }
  async json<T>(_opts: { model: 'tutor' | 'content'; system: string; prompt: string; maxTokens?: number }): Promise<{ data: T; model: string; tokensIn: number; tokensOut: number }> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

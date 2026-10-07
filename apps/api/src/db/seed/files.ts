import fs from 'node:fs';
import path from 'node:path';
import type { SeedLog } from './log';
import { errorMessage } from './log';

/** Repository `content/` folder (overridable with CONTENT_DIR). */
export function contentDir(): string {
  return process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR) : path.resolve(__dirname, '../../../../../content');
}

/** Parses a JSON file; logs and returns null when missing or invalid (files may be written concurrently). */
export function readJson(file: string, log: SeedLog): unknown {
  const rel = path.relative(contentDir(), file);
  if (!fs.existsSync(file)) {
    log.warn(rel, 'file not found');
    return null;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (!raw.trim()) {
      log.warn(rel, 'empty file skipped');
      return null;
    }
    return JSON.parse(raw);
  } catch (e) {
    log.warn(rel, `invalid JSON skipped (${errorMessage(e)})`);
    return null;
  }
}

/** Top-level *.json files of a folder, sorted; names starting with "_" are excluded. */
export function listJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json') && !d.name.startsWith('_'))
    .map((d) => path.join(dir, d.name))
    .sort();
}

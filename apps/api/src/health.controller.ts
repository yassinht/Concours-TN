import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDb } from './db/db.module';
import type { Database } from './db/client';

@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get()
  async health() {
    await this.db.execute(sql`select 1`);
    return { ok: true, time: new Date().toISOString() };
  }
}

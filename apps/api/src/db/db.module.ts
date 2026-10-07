import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { createDb } from './client';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

/** Inject the Drizzle database: `constructor(@InjectDb() private readonly db: Database) {}` */
export const InjectDb = () => Inject(DB);

const { db, pool } = createDb();

@Global()
@Module({
  providers: [
    { provide: DB, useValue: db },
    { provide: PG_POOL, useValue: pool },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onModuleDestroy() {
    await this.pool.end();
  }
}

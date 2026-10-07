import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema';

/** Database or transaction handle (both expose the same query builders). */
export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema>;

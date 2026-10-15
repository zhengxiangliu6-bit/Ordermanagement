import { Provider } from '@nestjs/common';

// pg-boss is ESM-only ("type": "module"); its types must be imported with
// an import resolution-mode so Node16 CommonJS compilation accepts them.
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

export const PG_BOSS = 'PG_BOSS';

/**
 * pg-boss instance backed by the same PostgreSQL database. Queue tables live
 * in the dedicated `pgboss` schema, separated from business tables
 * (framework decision 2.6). pg-boss is ESM-only, so the module is loaded
 * dynamically to keep the compiled CommonJS output intact.
 */
export const pgBossProvider: Provider = {
  provide: PG_BOSS,
  useFactory: async (): Promise<PgBoss> => {
    const { PgBoss: PgBossClient } = await import('pg-boss');
    return new PgBossClient({
      connectionString: process.env.DATABASE_URL,
      schema: 'pgboss',
    });
  },
};

export type { PgBoss };

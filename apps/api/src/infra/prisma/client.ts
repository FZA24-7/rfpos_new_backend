import { createPrismaClient, type PrismaClient } from '@mafk/database';

// DATABASE STATUS (Phase 4.2): typechecked against the generated client and used by the running API against
// PostgreSQL 16 in the sandbox.
<<<<<<< HEAD
export const buildPrismaClient = (databaseUrl: string): PrismaClient =>
  createPrismaClient({ databaseUrl });
=======
export const buildPrismaClient = (databaseUrl: string, poolMax?: number): PrismaClient =>
  createPrismaClient({ databaseUrl, ...(poolMax !== undefined ? { poolMax } : {}) });
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3

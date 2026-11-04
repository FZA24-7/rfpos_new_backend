import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export interface CreatePrismaClientOptions {
  databaseUrl: string;
  log?: ('query' | 'info' | 'warn' | 'error')[];
  /** Max pooled connections. Leave unset for the driver default; serverless hosts should use a small value. */
  poolMax?: number;
}

/** Single factory so every app (API, seed script, tests) builds the client the same way. */
export const createPrismaClient = (opts: CreatePrismaClientOptions): PrismaClient => {
  const adapter = new PrismaPg({
    connectionString: opts.databaseUrl,
    ...(opts.poolMax !== undefined ? { max: opts.poolMax } : {}),
  });
  // Prisma's default interactive-transaction limit is 5 s. Multi-step writes (for example creating a client with its roles
  // and ~190 permission links) take longer when the database is a network hop away, as on Vercel + Supabase.
  return new PrismaClient({
    adapter,
    log: opts.log ?? ['error', 'warn'],
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });
};

export type { PrismaClient } from './generated/client.js';
export { Prisma } from './generated/client.js';

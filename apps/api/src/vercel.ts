// Serverless entry for Vercel. Same composition as bin/server.ts but it never calls listen(): Vercel invokes the
// exported Express app as a request handler. The app is built once per warm function instance.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from './config/env.js';
import { createLogger } from './logger.js';
import { buildProductionApp } from './composition/production.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Handler | undefined;

const getApp = (): Handler => {
  if (!cached) {
    const env = loadEnv();
    // Small pool: every warm instance holds its own connections, and many instances can run at once.
    cached = buildProductionApp(env, createLogger(env), 1).app as unknown as Handler;
  }
  return cached;
};

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  getApp()(req, res);
}

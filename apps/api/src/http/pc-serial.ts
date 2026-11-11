import type { Request } from 'express';
import { PC_SERIAL_HEADER } from '@mafk/shared';

/** The PC serial the desktop app attaches to its requests; null when absent (plain browser). */
export const pcSerialOf = (req: Request): string | null => {
  const v = req.headers[PC_SERIAL_HEADER];
  return typeof v === 'string' ? v : null;
};

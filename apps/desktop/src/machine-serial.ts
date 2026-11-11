// Reads the serial number that identifies THIS computer (used by Sale > User PC Serial).
// Order: the hardware (BIOS / system) serial; when the maker left a placeholder there, the operating system's
// machine id instead. Whatever is returned is stable for the computer and is what the server compares against.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';

const PLACEHOLDERS = [
  'to be filled by o.e.m.',
  'to be filled by oem',
  'default string',
  'system serial number',
  'not specified',
  'not applicable',
  'none',
  'n/a',
  'unknown',
  'o.e.m.',
  'oem',
  'serial number',
  'chassis serial number',
  '0',
];

/** Trims and upper-cases a raw serial; returns null for empty, placeholder or all-one-character values. */
export const cleanSerial = (raw: string | null | undefined): string | null => {
  const v = (raw ?? '').replace(/[\r\n\0]+/g, ' ').trim();
  if (v.length < 4 || v.length > 80) return null;
  if (PLACEHOLDERS.includes(v.toLowerCase())) return null;
  if (/^(.)\1+$/.test(v)) return null; // 0000000, FFFFFFF...
  return v.toUpperCase();
};

export type Runner = (file: string, args: string[]) => Promise<string>;

export const defaultRunner: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 8000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.toString()),
    );
  });

const tryRun = async (run: Runner, file: string, args: string[]): Promise<string | null> => {
  try {
    return await run(file, args);
  } catch {
    return null;
  }
};

/** Pulls the value out of `reg query ... /v MachineGuid` output. */
export const parseMachineGuid = (out: string | null): string | null => {
  const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out ?? '');
  return m?.[1] ?? null;
};

export const readMachineSerial = async (
  platform: NodeJS.Platform = process.platform,
  run: Runner = defaultRunner,
  readFile: (p: string) => string | null = (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  },
): Promise<string | null> => {
  if (platform === 'win32') {
    const bios = cleanSerial(
      await tryRun(run, 'powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_BIOS).SerialNumber',
      ]),
    );
    if (bios) return bios;
    const legacy = cleanSerial(
      (await tryRun(run, 'wmic', ['bios', 'get', 'serialnumber']))?.replace(/serialnumber/i, '') ??
        null,
    );
    if (legacy) return legacy;
    return cleanSerial(
      parseMachineGuid(
        await tryRun(run, 'reg', [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid',
        ]),
      ),
    );
  }
  if (platform === 'darwin') {
    const out = await tryRun(run, 'ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return cleanSerial(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/.exec(out ?? '')?.[1]);
  }
  return (
    cleanSerial(readFile('/sys/class/dmi/id/product_serial')) ??
    cleanSerial(readFile('/etc/machine-id')) ??
    cleanSerial(readFile('/var/lib/dbus/machine-id'))
  );
};

let cached: Promise<string | null> | null = null;
/** Read once per run of the app (PowerShell takes a moment). */
export const getMachineSerial = (): Promise<string | null> => (cached ??= readMachineSerial());

import { describe, expect, it } from 'vitest';
import { cleanSerial, parseMachineGuid, readMachineSerial } from '../src/machine-serial';

describe('machine serial', () => {
  it('cleans real serials and rejects maker placeholders', () => {
    expect(cleanSerial('  abc1234xyz\r\n')).toBe('ABC1234XYZ');
    for (const bad of [
      '',
      'To be filled by O.E.M.',
      'Default string',
      'None',
      '0000000000',
      'FFFFFFFF',
      'x',
      null,
      undefined,
    ])
      expect(cleanSerial(bad)).toBeNull();
  });
  it('parses MachineGuid from reg output', () => {
    const out =
      '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    1a2b3c4d-1111-2222-3333-444455556666\r\n';
    expect(parseMachineGuid(out)).toBe('1a2b3c4d-1111-2222-3333-444455556666');
    expect(parseMachineGuid(null)).toBeNull();
  });
  it('Windows: BIOS serial first, then the machine GUID when the BIOS has a placeholder', async () => {
    const bios = async (f: string) =>
      f === 'powershell.exe' ? 'PF2ABC12\r\n' : Promise.reject(new Error('x'));
    expect(await readMachineSerial('win32', bios)).toBe('PF2ABC12');
    const guid = async (f: string) =>
      f === 'powershell.exe'
        ? 'To be filled by O.E.M.'
        : f === 'reg'
          ? 'MachineGuid REG_SZ abcd-ef01-2345'
          : Promise.reject(new Error('x'));
    expect(await readMachineSerial('win32', guid)).toBe('ABCD-EF01-2345');
    expect(
      await readMachineSerial('win32', async () => Promise.reject(new Error('nope'))),
    ).toBeNull();
  });
  it('macOS and Linux', async () => {
    expect(
      await readMachineSerial('darwin', async () => '  "IOPlatformSerialNumber" = "C02XYZ123"\n'),
    ).toBe('C02XYZ123');
    expect(
      await readMachineSerial(
        'linux',
        async () => '',
        (p) => (p.endsWith('machine-id') ? 'deadbeefcafe\n' : null),
      ),
    ).toBe('DEADBEEFCAFE');
  });
});

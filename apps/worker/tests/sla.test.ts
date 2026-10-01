import { describe, expect, it } from 'vitest';
import { addMinutes, validatePolicy } from '../src/domain/sla';
import type { SlaPolicy } from '@masci/contracts';

const policy: SlaPolicy = {
  responseMinutes: 60, resolutionMinutes: 240, escalationMinutes: 30,
  maxLevel: 3, businessHours: true, startHour: 9, endHour: 17, holidays: ['2026-10-01'],
};

describe('Thailand business-hours SLA', () => {
  it('continues after closing on the next working day', () => {
    const start = Date.parse('2026-09-30T16:30:00+07:00');
    expect(addMinutes(start, 60, policy)).toBe(Date.parse('2026-10-02T09:30:00+07:00'));
  });

  it('skips weekends', () => {
    const start = Date.parse('2026-10-02T16:30:00+07:00');
    expect(addMinutes(start, 60, policy)).toBe(Date.parse('2026-10-05T09:30:00+07:00'));
  });

  it('rejects invalid SLA policy values', () => {
    expect(() => validatePolicy({ ...policy, maxLevel: 0 })).toThrow('Invalid SLA policy');
  });
});

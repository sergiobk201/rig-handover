import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28')!;
  const row = (job: string) => night.rows.find((r) => r.job === job)!;

  it('has 5 rows sorted by job, 1 bad line and counts per status', () => {
    expect(night.night).toBe('2026-10-28');
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps the last error after a recovery', () => {
    expect(row('fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
  });

  it('reports a failure with its error', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps a row whose owner is null', () => {
    expect(row('digest/render').owner).toBeNull();
  });

  it('keeps times as written', () => {
    expect(row('lane/sync').firstAt).toBe('2026-10-28T23:00:06+01:00');
  });

  it('returns null for a missing night or a name outside YYYY-MM-DD', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
    expect(readNight('runs', '../x')).toBeNull();
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const nightFrom = (name: string, lines: string[]) => {
    writeFileSync(join(dir, `${name}.jsonl`), lines.join('\n'));
    return readNight(dir, name)!;
  };

  it('reads an empty file as no rows', () => {
    expect(nightFrom('2026-01-01', [])).toEqual({ night: '2026-01-01', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('skips blank lines without counting them', () => {
    const n = nightFrom('2026-01-02', ['', '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":"x"}', '   ', '']);
    expect(n.rows).toHaveLength(1);
    expect(n.badLines).toBe(0);
  });

  it('counts bad JSON and wrong-typed or missing fields as bad lines', () => {
    const n = nightFrom('2026-01-03', [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '{not json',
      '[1,2]',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":42,"status":"ok","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":7}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok"}',
      '{"at":"yesterday","job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"fail","owner":"x","error":500}',
    ]);
    expect(n.badLines).toBe(8);
    expect(n.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('orders by instant across offsets, keeping the strings as written', () => {
    const n = nightFrom('2026-01-04', [
      '{"at":"2026-01-04T02:00:00+01:00","job":"a","status":"ok","owner":"late"}',
      '{"at":"2026-01-04T00:30:00Z","job":"a","status":"retry","owner":"early","error":"boom"}',
    ]);
    expect(n.rows[0]).toMatchObject({
      firstAt: '2026-01-04T00:30:00Z',
      lastAt: '2026-01-04T02:00:00+01:00',
      owner: 'late',
      lastStatus: 'ok',
      lastError: 'boom',
    });
  });
});

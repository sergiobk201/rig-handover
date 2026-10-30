import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const lines = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(
    join(dir, '2026-01-01.jsonl'),
    lines(
      { at: '2026-01-01T23:00:00+01:00', job: 'zeta/last', status: 'ok', owner: 'rook' },
      { at: '2026-01-01T23:10:00+01:00', job: 'alpha/first', status: 'retry', owner: null, error: 'upstream 503' },
      { at: '2026-01-01T23:20:00+01:00', job: 'alpha/first', status: 'fail', owner: null, error: 'gave up' },
      { at: '2026-01-02T00:30:00+01:00', job: 'mid/job', status: 'ok', owner: 'lane-07' },
    ),
  );
  writeFileSync(join(dir, '2026-01-02.jsonl'), '');
  writeFileSync(
    join(dir, '2026-01-03.jsonl'),
    lines({ at: '2026-01-03T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }) +
      'this is not json\n',
  );
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('200 for a night with jobs, one row per job', async () => {
    const res = await app.request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-01-01');
    expect(html).toContain('<table');
    expect(html).toContain('2026-01-01T23:10:00+01:00');
    expect(html).toContain('gave up');
    expect(html).toContain('—');
    expect(html).not.toContain('nothing ran');
    expect(html.match(/<tr/g)?.length).toBe(4);
  });

  it('marks failing or retry-heavy rows with class="warn"', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    expect(html.match(/<tr class="warn"/g)?.length).toBe(1);
  });

  it('404 for a night with no file', async () => {
    expect((await app.request('/digest/2026-01-09')).status).toBe(404);
  });

  it('says "nothing ran" and has no table for an empty night', async () => {
    const res = await app.request('/digest/2026-01-02');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('renders a night with a bad line and counts it', async () => {
    const res = await app.request('/digest/2026-01-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lane/sync');
    expect(html).toContain("1 line didn't parse");
  });

  it('404 for a night that is not YYYY-MM-DD', async () => {
    expect((await app.request('/digest/tonight')).status).toBe(404);
    expect((await app.request('/digest/2026-1-1')).status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with the Night for a night with jobs', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    const night = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(night.night).toBe('2026-01-01');
    expect(night.rows.map((r) => r.job)).toEqual(['alpha/first', 'mid/job', 'zeta/last']);
    expect(night.counts).toEqual({ ok: 2, retry: 1, fail: 1 });
  });

  it('404 with { error } for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-01-09');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it('has no rows for an empty night', async () => {
    const res = await app.request('/api/digest/2026-01-02');
    const night = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(0);
  });

  it('counts the bad line and keeps the good one', async () => {
    const night = (await (await app.request('/api/digest/2026-01-03')).json()) as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['lane/sync']);
  });

  it('404 for a night that is not YYYY-MM-DD', async () => {
    const res = await app.request('/api/digest/tonight');
    expect(res.status).toBe(404);
    expect((await app.request('/api/digest/2026-1-1')).status).toBe(404);
  });
});

describe('page and JSON agree (ADR 0001)', () => {
  it('list the same jobs in the same order', async () => {
    const night = (await (await app.request('/api/digest/2026-01-01')).json()) as Night;
    const html = await (await app.request('/digest/2026-01-01')).text();
    const at = night.rows.map((r) => html.indexOf(r.job));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});

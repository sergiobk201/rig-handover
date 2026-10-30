// Plan morning-digest § 1. The contract the page, the JSON and the board link (§ 2) build on.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night. `owner` and `lastStatus` come from its latest line; times are the log's
// `at` strings as written, offset included.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// `rows` sorted by job; `counts` = parsed lines per status; `badLines` = lines that didn't parse.
export type Night = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// null when `night` is not YYYY-MM-DD or runs/<night>.jsonl does not exist.
export type ReadNight = (runsDir: string, night: string) => Night | null;

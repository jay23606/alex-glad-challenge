#!/usr/bin/env node
// Wall-clock and run metrics for a pool of GitHub issues (AGENTS §13.9).
// Start = earliest `in-progress` label event; fallback = previous issue close
// (sequential loop). End = closedAt, or now for open issues.
// Run metrics (first-try, causes, interventions) exist only for issues carrying
// `loop-run`: without that label the executor did not promise instrumentation,
// so the script reports n/a instead of guessing.
//
// Usage: node scripts/loop-metrics.mjs [--from N] [--to M] [--repo owner/name] [--milestone NAME]
//        node scripts/loop-metrics.mjs --self-test

import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const CAUSE_PREFIX = 'cause:';

function fail(message) {
  console.error(`loop-metrics: ${message}`);
  process.exit(1);
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    fail(`gh ${args.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--from' || key === '--to' || key === '--repo' || key === '--milestone') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${key} needs a value`);
      out[key.slice(2)] = key === '--from' || key === '--to' ? Number(value) : value;
      i += 1;
    } else if (key === '--self-test') {
      out.selfTest = true;
    } else if (key === '--help' || key === '-h') {
      console.log('usage: node scripts/loop-metrics.mjs [--from N] [--to M] [--repo owner/name] [--milestone NAME]');
      process.exit(0);
    } else {
      fail(`unknown argument: ${key}`);
    }
  }
  if (out.from !== undefined && !Number.isInteger(out.from)) fail('--from must be an integer');
  if (out.to !== undefined && !Number.isInteger(out.to)) fail('--to must be an integer');
  if (out.from !== undefined && out.to !== undefined && out.from > out.to) fail('--from > --to');
  return out;
}

function minutes(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Earliest `in-progress` label event wins; otherwise the caller's fallback.
function pickStart(events, fallbackIso, fallbackSource) {
  const labelEvent = events
    .filter((event) => event.event === 'labeled' && event.label?.name === 'in-progress')
    .map((event) => event.created_at)
    .sort()[0];
  return labelEvent
    ? { start: labelEvent, source: 'in-progress' }
    : { start: fallbackIso, source: fallbackSource };
}

// Aggregate metrics that need structured labels. n/a means "not instrumented",
// never "zero" and never a guess.
function summarize(rows) {
  const closed = rows.filter((row) => row.state === 'CLOSED');
  const durations = closed.map((row) => row.duration);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const instrumented = rows.filter((row) => row.labels.includes('loop-run'));
  const firstTryBase = instrumented.filter((row) => row.state === 'CLOSED');
  const causes = {};
  for (const row of instrumented) {
    for (const label of row.labels) {
      if (label.startsWith(CAUSE_PREFIX)) causes[label] = (causes[label] ?? 0) + 1;
    }
  }
  return {
    closed: closed.length,
    total,
    mean: durations.length ? total / durations.length : 0,
    median: median(durations),
    instrumented: instrumented.length,
    firstTry: firstTryBase.length
      ? {
        passed: firstTryBase.filter((row) => !row.labels.includes('iteration:2')).length,
        total: firstTryBase.length,
      }
      : null,
    askedUser: instrumented.length
      ? instrumented.filter((row) => row.labels.includes('asked-user')).length
      : null,
    causes: Object.keys(causes).length ? causes : null,
  };
}

function stamp(iso) {
  return iso ? iso.slice(5, 16).replace('T', ' ') : '—';
}

function selfTest() {
  const labeled = [
    { event: 'labeled', label: { name: 'bug' }, created_at: '2026-01-01T00:00:00Z' },
    { event: 'labeled', label: { name: 'in-progress' }, created_at: '2026-01-01T00:05:00Z' },
  ];
  assert.deepEqual(pickStart(labeled, '2026-01-01T00:00:00Z', 'prev-close'), {
    start: '2026-01-01T00:05:00Z',
    source: 'in-progress',
  });
  assert.deepEqual(pickStart([labeled[0]], '', 'created'), { start: '', source: 'created' });
  assert.deepEqual(pickStart([], '2026-01-01T00:00:00Z', 'prev-close'), {
    start: '2026-01-01T00:00:00Z',
    source: 'prev-close',
  });
  assert.equal(minutes('2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'), 10);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2]), 1.5);

  const row = (state, labels, duration) => ({
    state, labels, duration, number: 0, priority: '—', start: '', end: '', source: 'created', title: '',
  });
  const uninstrumented = summarize([row('CLOSED', ['bug'], 2), row('CLOSED', ['bug', 'iteration:2'], 4)]);
  assert.equal(uninstrumented.firstTry, null);
  assert.equal(uninstrumented.askedUser, null);
  assert.equal(uninstrumented.causes, null);

  const instrumented = summarize([
    row('CLOSED', ['loop-run', 'iteration:2', 'cause:code'], 4),
    row('CLOSED', ['loop-run', 'asked-user'], 2),
    row('CLOSED', ['loop-run'], 6),
  ]);
  assert.deepEqual(instrumented.firstTry, { passed: 2, total: 3 });
  assert.equal(instrumented.askedUser, 1);
  assert.deepEqual(instrumented.causes, { 'cause:code': 1 });
  assert.equal(instrumented.median, 4);
  console.log('self-test: ok');
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  selfTest();
  process.exit(0);
}

const repo = args.repo ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
if (!repo.includes('/')) fail('cannot resolve repo; pass --repo owner/name');

const listArgs = [
  'issue', 'list', '--repo', repo, '--state', 'all', '--limit', '1000',
  '--json', 'number,title,state,createdAt,closedAt,labels',
];
if (args.milestone) listArgs.push('--milestone', args.milestone);
const issues = JSON.parse(gh(listArgs))
  .filter((issue) => (args.from === undefined || issue.number >= args.from)
    && (args.to === undefined || issue.number <= args.to))
  .sort((a, b) => a.number - b.number);
if (issues.length === 0) fail(`no issues in ${repo} for the requested range`);

const now = new Date().toISOString();
const rows = [];
let labelledStarts = 0;
let fallbackStarts = 0;
let previousEnd = null;

for (const issue of issues) {
  const timeline = JSON.parse(gh([
    'api', `repos/${repo}/issues/${issue.number}/timeline`, '--paginate', '--slurp',
  ])).flat();
  const { start, source } = pickStart(
    timeline,
    previousEnd ?? issue.createdAt,
    previousEnd ? 'prev-close' : 'created',
  );
  if (source === 'in-progress') labelledStarts += 1;
  else fallbackStarts += 1;
  const end = issue.closedAt ?? now;
  const labels = issue.labels.map((label) => label.name);
  const duration = minutes(start, end);
  previousEnd = end;
  const priority = labels
    .filter((name) => /^P[0-3]$/.test(name))
    .sort()
    .join(',') || '—';
  rows.push({
    number: issue.number,
    priority,
    state: issue.state,
    start,
    end,
    duration,
    source,
    title: issue.title,
    labels,
  });
}

const summary = summarize(rows);
const anomalies = rows.filter((row) => row.state === 'CLOSED' && row.duration < 0).length;

console.log(`repo: ${repo}${args.milestone ? ` | milestone: ${args.milestone}` : ''} | issues: ${rows.length} | starts: in-progress ${labelledStarts}, fallback ${fallbackStarts}`);
console.log('');
console.log('| # | P | Статус | Старт (UTC) | Конец (UTC) | Мин |');
console.log('|---|---|---|---|---|---|');
for (const row of rows) {
  const flag = row.state === 'CLOSED' ? '' : ' (open)';
  console.log(`| ${row.number} | ${row.priority} | ${row.state}${flag} | ${stamp(row.start)} | ${stamp(row.end)} | ${row.duration.toFixed(2)} |`);
}
console.log('');
console.log(`closed: ${summary.closed} | total: ${summary.total.toFixed(1)} min | mean: ${summary.mean.toFixed(2)} min | median: ${summary.median.toFixed(2)} min`);
const firstTry = summary.firstTry
  ? `${summary.firstTry.passed}/${summary.firstTry.total} (${((summary.firstTry.passed / summary.firstTry.total) * 100).toFixed(1)}%)`
  : 'n/a (no loop-run labels)';
const askedUser = summary.askedUser === null ? 'n/a (no loop-run labels)' : String(summary.askedUser);
const causes = summary.causes
  ? Object.entries(summary.causes).sort().map(([label, count]) => `${label.slice(CAUSE_PREFIX.length)} ${count}`).join(', ')
  : 'n/a (no loop-run labels)';
console.log(`instrumented: ${summary.instrumented}/${rows.length} (loop-run) | first-try: ${firstTry} | asked-user: ${askedUser} | causes: ${causes}`);
if (anomalies > 0) {
  console.error(`warning: ${anomalies} issue(s) have a start after their end (stale in-progress label?)`);
}

// Machine-readable tail for smoke checks.
if (process.env.LOOP_METRICS_JSON === '1') {
  console.log(JSON.stringify({ repo, milestone: args.milestone ?? null, rows, summary }));
}

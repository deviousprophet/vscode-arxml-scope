import { appendFileSync, existsSync, readFileSync } from "node:fs";

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? "unknown";
const logFile = process.env.LOG_FILE ?? "test-output.log";
const suiteName = process.env.SUITE_NAME ?? "Automated test results";
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

const ICONS = {
  passed: "\u2705",
  failed: "\u274c",
  timer: "\u23f1",
  clipboard: "\u{1F4CB}",
  log: "\u{1FAB5}",
  zap: "\u26A1",
};

function appendSummary(markdown) {
  if (summaryPath) {
    appendFileSync(summaryPath, markdown, "utf8");
    return;
  }

  process.stdout.write(markdown);
}

function tailLines(logText, count) {
  return logText.split(/\r?\n/).slice(-count).join("\n");
}

function readLog() {
  return existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
}

// ---------------------------------------------------------------------------
// Mocha format
// ---------------------------------------------------------------------------

function firstNumber(pattern, text) {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : 0;
}

function passingDuration(text) {
  return /[0-9]+ passing \(([^)]+)\)/.exec(text)?.[1] ?? "";
}

function failureBlock(text) {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^[ \t]+[0-9]+ failing/.test(line));
  return startIndex === -1 ? "" : lines.slice(startIndex + 1).join("\n").trimEnd();
}

function failedTitles(block) {
  return block
    .split(/\r?\n/)
    .map((line) => /^[ \t]+[0-9]+\) (.+)$/.exec(line)?.[1])
    .filter(Boolean);
}

function parseMochaStats(logText) {
  const pass = firstNumber(/([0-9]+) passing \([^)]+\)/, logText);
  const fail = firstNumber(/([0-9]+) failing/, logText);
  const duration = passingDuration(logText);
  return { pass, fail, duration, total: pass + fail };
}

function hasMochaOutput(logText) {
  return /[0-9]+ passing \([^)]+\)/.test(logText) || /[0-9]+ failing/.test(logText);
}

function testsDidNotRun(total) {
  return runTestsOutcome !== "success" && total === 0;
}

function allTestsPassed(fail, total) {
  return fail === 0 && total > 0;
}

function mochaStatusLine({ fail, total }) {
  if (testsDidNotRun(total)) {
    return `${ICONS.failed} Tests were not executed successfully`;
  }
  if (allTestsPassed(fail, total)) {
    return `${ICONS.passed} All tests passed`;
  }
  return `${ICONS.failed} Some tests failed`;
}

function renderMochaHeader(stats) {
  const durationSuffix = stats.duration ? ` ${ICONS.timer} ${stats.duration}` : "";
  const status = `${mochaStatusLine(stats)}${durationSuffix}`;

  appendSummary(`# ${ICONS.clipboard} ${suiteName}

${status}

| ${ICONS.passed} Passed | ${ICONS.failed} Failed | ${ICONS.clipboard} Total |
|---:|---:|---:|
| ${stats.pass} | ${stats.fail} | ${stats.total} |
`);
}

function renderMochaFailures(logText, fail) {
  if (fail === 0 || !logText) {
    return;
  }

  const block = failureBlock(logText);
  const titles = failedTitles(block);
  const titleList = titles.map((title) => `- \`${title}\`\n`).join("");

  appendSummary(`
<details>
<summary>${ICONS.failed} ${fail} failing test(s)</summary>

${titleList}
### Error details

\`\`\`
${block}
\`\`\`

</details>
`);
}

function renderMochaMissingRun(logText, total) {
  const shouldRender = testsDidNotRun(total) && logText;
  if (!shouldRender) {
    return;
  }

  appendSummary(`
## ${ICONS.log} Last 30 lines of output

\`\`\`
${tailLines(logText, 30)}
\`\`\`
`);
}

function summarizeMocha() {
  const logText = readLog();

  // A benchmark log contains typed JSON records and no Mocha output; the typed
  // summary below renders it, so an empty Mocha header would only be noise.
  // A test log that failed before Mocha printed anything still renders the
  // "tests were not executed" header and its tail below.
  if (groupByType(logText).size > 0 && !hasMochaOutput(logText)) {
    return;
  }

  const stats = parseMochaStats(logText);

  // A successful run with no tests is not expected for this repository, but
  // avoid an empty summary if it happens.
  if (stats.total === 0 && !testsDidNotRun(0)) {
    return;
  }

  renderMochaHeader(stats);
  renderMochaFailures(logText, stats.fail);
  renderMochaMissingRun(logText, stats.total);
}

// ---------------------------------------------------------------------------
// Typed benchmark registry — a new benchmark type needs one renderer here
// ---------------------------------------------------------------------------

function tryParseJsonLine(line) {
  // `trim` also drops a leading BOM, which `JSON.parse` rejects.
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try { return JSON.parse(trimmed); } catch { return null; }
}

function groupEntry(groups, line) {
  const entry = tryParseJsonLine(line);
  if (!entry || typeof entry._type !== "string") {
    return;
  }
  if (!groups.has(entry._type)) {
    groups.set(entry._type, []);
  }
  groups.get(entry._type).push(entry);
}

/** Group parsed log lines by _type. Lines without _type are ignored here. */
function groupByType(logText) {
  const groups = new Map();
  logText.split(/\r?\n/).forEach(line => groupEntry(groups, line));
  return groups;
}

function statusBadge() {
  return runTestsOutcome === "success"
    ? `${ICONS.passed} Passed`
    : `${ICONS.failed} Failed`;
}

function renderFailureTail(logText) {
  if (runTestsOutcome === "success" || !logText) {
    return;
  }
  appendSummary(`
<details>
<summary>${ICONS.failed} Failure output</summary>

\`\`\`
${tailLines(logText, 40)}
\`\`\`

</details>
`);
}

// -- Renderers registered by _type ------------------------------------------

const registry = new Map();

function renderTable(headers, rows) {
  const header = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
  const body = rows.map((row) => `| ${row.map((value) => value ?? "").join(" | ")} |\n`).join("");
  return `${header}${body}\n`;
}

registry.set("large-file-load", (records) => ({
  body: renderTable(
    ["Name", "Source (MiB)", "Records", "Elapsed (ms)", "Retained (MiB)"],
    records.map((r) => [r.name, r.sourceMiB, r.records, r.elapsedMs, r.retainedMiB])
  ),
}));

registry.set("large-file-summary", (records) => ({
  body: renderTable(
    ["Documents", "Source (MiB)", "Concurrent retained (MiB)"],
    records.map((s) => [s.documents?.join(", ") ?? "", s.sourceMiB, s.concurrentRetainedMiB])
  ),
}));

registry.set("memory-release", (records) => {
  const m = records[0];
  if (!m) {
    return { body: `${ICONS.failed} No measurement found.\n\n` };
  }
  return {
    body: renderTable(
      ["Baseline", "Opened", "Closed", "Allocated", "Retained"],
      [[m.baseline, m.opened, m.closed, m.allocated, m.retained]]
    ),
  };
});

registry.set("diff-toggle", (records) => ({
  body: renderTable(
    [
      "Source rows",
      "Renamed",
      "Strict rows",
      "Semantic first (ms)",
      "Strict first (ms)",
      "Cached (ms)",
      "Equivalent first (ms)",
      "Equivalent cached (ms)",
    ],
    records.map((r) => [
      r.sourceRows,
      r.renamed,
      r.strictRows,
      r.semanticFirstMs,
      r.strictFirstMs,
      r.cachedMs,
      r.equivalentFirstMs,
      r.equivalentCachedMs,
    ])
  ),
}));

registry.set("diff-semantic", (records) => ({
  body: renderTable(
    ["Source rows", "Pairs", "Changed", "Elapsed (ms)", "Retained (MiB)"],
    records.map((r) => [r.sourceRows, r.pairs, r.changed, r.elapsedMs, r.retainedMiB])
  ),
}));

registry.set("diff-semantic-embedded", (records) => ({
  body: renderTable(
    ["Source rows", "Pairs", "Elapsed (ms)", "Retained (MiB)"],
    records.map((r) => [r.sourceRows, r.pairs, r.elapsedMs, r.retainedMiB])
  ),
}));

registry.set("rename-scale", (records) => ({
  body: renderTable(
    [
      "Renames",
      "Source rows",
      "Pairs",
      "Changed",
      "Added",
      "Removed",
      "Limited",
      "Reason",
      "Elapsed (ms)",
      "Retained (MiB)",
    ],
    records.map((r) => [
      r.renames,
      r.sourceRows,
      r.pairs,
      r.changed,
      r.added,
      r.removed,
      r.limited,
      r.reason,
      r.elapsedMs,
      r.retainedMiB,
    ])
  ),
}));

registry.set("index-mutation", (records) => ({
  body: renderTable(
    ["Name", "Elapsed (ms)", "Resolved"],
    records.map((r) => [r.name, r.elapsedMs, r.resolved])
  ),
}));

registry.set("index-references", (records) => ({
  body: renderTable(
    ["Name", "References", "Elapsed (ms)"],
    records.map((r) => [r.name, r.references, r.elapsedMs])
  ),
}));

registry.set("index-find-references", (records) => ({
  body: renderTable(
    ["Name", "References", "Full builds", "Elapsed (ms)"],
    records.map((r) => [r.name, r.references, r.builds, r.elapsedMs])
  ),
}));

registry.set("validation", (records) => ({
  body: renderTable(
    ["Source (MiB)", "Records", "Diagnostics", "Elapsed (ms)", "Retained (MiB)"],
    records.map((r) => [r.sourceMiB, r.records, r.diagnostics, r.elapsedMs, r.retainedMiB])
  ),
}));

registry.set("validation-slices", (records) => ({
  body: renderTable(
    ["Slices", "Max slice (ms)", "Diagnostics", "Elapsed (ms)"],
    records.map((r) => [r.slices, r.maxSliceMs, r.diagnostics, r.elapsedMs])
  ),
}));

// -- Typed-summary driver ---------------------------------------------------

function renderUnknownType(type, records) {
  console.warn(`Unknown benchmark type: ${type}`);
  return {
    body: `\n<details>\n<summary>\`${type}\` (unknown benchmark type)</summary>\n\n\`\`\`json\n${records.map(r => JSON.stringify(r, null, 2)).join("\n")}\n\`\`\`\n\n</details>\n`
  };
}

function typeDisplayName(type) {
  return type
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renderTypedGroup(type, records, logText) {
  const renderer = registry.get(type);
  const { header = "", body = "" } = renderer
    ? renderer(records, logText)
    : renderUnknownType(type, records);
  const text = `## ${typeDisplayName(type)}

${statusBadge()}

${header}${body}`;
  if (text.trim()) {
    appendSummary(text);
  }
}

function summarizeTyped() {
  const logText = readLog();
  const groups = groupByType(logText);

  if (groups.size === 0) {
    return;
  }

  appendSummary(`\n---\n# ${ICONS.zap} Benchmark\n`);
  for (const [type, records] of groups) {
    renderTypedGroup(type, records, logText);
  }
  renderFailureTail(logText);
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

summarizeMocha();
summarizeTyped();

#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { renderDashboard } from './dashboard-template.mjs';
import { applyThreadsViewResults, validateThreadsViewArtifact } from './threads-views-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.dirname(scriptDirectory);
const parentDirectory = path.dirname(projectDirectory);
const dataPath = path.join(
  parentDirectory,
  'SNS横断ダッシュボード_実データ',
  '2026-08-29_X_Threads_1month_comparison.json',
);
const threadsViewsPath = path.join(
  parentDirectory,
  'SNS横断ダッシュボード_実データ',
  '2026-08-29_Threads_views_public_ui.json',
);
const outputPath = path.join(parentDirectory, 'SNS横断ダッシュボード_X_Threads1ヶ月実データ版.html');

export async function generateDashboard({ input = dataPath, viewsInput = threadsViewsPath, output = outputPath } = {}) {
  let data = JSON.parse(await readFile(input, 'utf8'));
  const viewsArtifact = JSON.parse(await readFile(viewsInput, 'utf8'));
  validateThreadsViewArtifact(data, viewsArtifact, { sourceFile: path.basename(input) });
  data = applyThreadsViewResults(data, viewsArtifact.results, { collectedAt: viewsArtifact.completed_at });
  data.threads_views_enrichment.source_file = path.basename(viewsInput);
  const html = renderDashboard(data);
  const temporaryPath = `${output}.tmp-${process.pid}`;
  await writeFile(temporaryPath, html, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, output);
  return { input, output, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateDashboard()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.message ?? String(error)}\n`);
      process.exitCode = 1;
    });
}

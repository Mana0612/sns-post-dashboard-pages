#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

import { inspectThreadsPagePayload, parseThreadsViewText } from './threads-views-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.dirname(scriptDirectory);
const parentDirectory = path.dirname(projectDirectory);
const defaultInput = path.join(
  parentDirectory,
  'SNS横断ダッシュボード_実データ',
  '2026-08-29_X_Threads_1month_comparison.json',
);
const defaultOutput = path.join(
  parentDirectory,
  'SNS横断ダッシュボード_実データ',
  '2026-08-29_Threads_views_public_ui.json',
);

function parseArguments(argv) {
  const options = { input: defaultInput, output: defaultOutput, delayMs: 1800, limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') options.input = path.resolve(argv[++index]);
    else if (argument === '--output') options.output = path.resolve(argv[++index]);
    else if (argument === '--delay-ms') options.delayMs = Number(argv[++index]);
    else if (argument === '--limit') options.limit = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 1000) {
    throw new Error('--delay-ms must be at least 1000');
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  return options;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizedResponseUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

async function writeJsonAtomic(output, value) {
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, output);
}

async function collectOne(browser, entry) {
  let lastError = null;
  let lastBoundMissing = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const capturedAt = new Date().toISOString();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (!response || response.status() !== 200) throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
      const responseUrl = normalizedResponseUrl(response.url());
      if (responseUrl !== normalizedResponseUrl(entry.url) || normalizedResponseUrl(page.url()) !== responseUrl) {
        throw new Error(`Threads response URL does not match: ${responseUrl}`);
      }
      const responsePayload = await response.text();
      const evidence = inspectThreadsPagePayload(responsePayload, entry.post_id);
      const payload = evidence.view_metric;
      let visible = null;
      try {
        visible = parseThreadsViewText(await page.evaluate(() => document.body?.innerText ?? ''));
      } catch {
        // Related cards can add multiple view lines. The route-bound payload remains authoritative.
      }
      if (visible && payload && visible.value !== payload.value) {
        throw new Error(`Visible/payload view count mismatch: ${visible.value} != ${payload.value}`);
      }
      const parsed = payload;
      if (!parsed) {
        lastBoundMissing = {
          captured_at: capturedAt,
          payload_post_id: evidence.post_id,
          response_url: responseUrl,
        };
        throw new Error('View count line not found');
      }
      return {
        group_id: entry.group_id,
        post_id: entry.post_id,
        url: entry.url,
        status: 'ok',
        captured_at: capturedAt,
        capture_source: visible?.value === payload.value ? 'visible_text' : 'page_response_bound',
        payload_post_id: evidence.post_id,
        response_url: responseUrl,
        ...parsed,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(5000);
    } finally {
      await page.close();
    }
  }
  if (lastBoundMissing && String(lastError?.message ?? '').includes('not found')) {
    return {
      group_id: entry.group_id,
      post_id: entry.post_id,
      url: entry.url,
      status: 'missing',
      ...lastBoundMissing,
      error: 'View count line not found',
    };
  }
  return {
    group_id: entry.group_id,
    post_id: entry.post_id,
    url: entry.url,
    status: 'error',
    captured_at: new Date().toISOString(),
    error: String(lastError?.message ?? lastError ?? 'Unknown error').slice(0, 300),
  };
}

export async function collectThreadsViews({ input, output, delayMs = 1800, limit = null }) {
  const source = JSON.parse(await readFile(input, 'utf8'));
  const allEntries = source.rows
    .filter((row) => row.threads?.url)
    .map((row) => ({
      group_id: row.group_id,
      post_id: row.threads.post_id ?? row.threads.url.split('/').at(-1),
      url: row.threads.url,
    }));
  const entries = limit === null ? allEntries : allEntries.slice(0, limit);
  if (new Set(entries.map((entry) => entry.url)).size !== entries.length) {
    throw new Error('Duplicate Threads URLs in source data');
  }

  const startedAt = new Date().toISOString();
  const artifact = {
    schema_version: 1,
    source_file: path.basename(input),
    capture_method: 'public_post_detail_page',
    logged_in: false,
    started_at: startedAt,
    completed_at: null,
    delay_ms: delayMs,
    results: [],
  };
  await writeJsonAtomic(output, artifact);

  const browser = await puppeteer.launch({ headless: true });
  try {
    for (let index = 0; index < entries.length; index += 1) {
      const result = await collectOne(browser, entries[index]);
      artifact.results.push(result);
      await writeJsonAtomic(output, artifact);
      process.stderr.write(`[${index + 1}/${entries.length}] ${result.status} ${result.post_id}${result.display ? ` ${result.display}` : ''}\n`);
      if (index + 1 < entries.length) await wait(delayMs + Math.floor(Math.random() * 700));
    }
  } finally {
    await browser.close();
  }

  artifact.completed_at = new Date().toISOString();
  artifact.summary = {
    attempted_count: artifact.results.length,
    collected_count: artifact.results.filter((result) => result.status === 'ok').length,
    missing_count: artifact.results.filter((result) => result.status === 'missing').length,
    error_count: artifact.results.filter((result) => result.status === 'error').length,
    approximate_count: artifact.results.filter((result) => result.status === 'ok' && result.is_approximate).length,
  };
  await writeJsonAtomic(output, artifact);
  return { output, ...artifact.summary };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  collectThreadsViews(parseArguments(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
      process.exitCode = 1;
    });
}

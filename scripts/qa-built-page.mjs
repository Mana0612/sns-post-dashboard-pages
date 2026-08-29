#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.dirname(scriptDirectory);
const pagePath = path.join(projectDirectory, 'docs', 'index.html');

function readPassword() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this check from an interactive terminal');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error);
      else if (!value) reject(new Error('No password was provided'));
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stderr.write('Enter page password for QA: ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function startServer(html) {
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    url: `http://127.0.0.1:${address.port}/`,
  };
}

async function main() {
  const password = await readPassword();
  const server = await startServer(await readFile(pagePath, 'utf8'));
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const externalRequests = [];
  const browserErrors = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(server.url) && !url.startsWith('blob:') && !url.startsWith('data:')) {
      externalRequests.push(url);
    }
  });
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.type('#password', password);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => document.body.classList.contains('unlocked'), { timeout: 15_000 });
    const dashboard = page.frames().find((frame) => frame !== page.mainFrame());
    await dashboard.waitForSelector('.post-card');
    const initial = await dashboard.evaluate(() => ({
      title: document.querySelector('h1')?.textContent,
      counts: [...document.querySelectorAll('.summary-card strong')].map((node) => Number(node.textContent)),
      cards: document.querySelectorAll('.post-card').length,
      treeNodes: document.querySelectorAll('.thread-node').length,
      platformLinks: document.querySelectorAll('a.platform-link').length,
      partLinks: document.querySelectorAll('a.part-link').length,
      unsafeLinks: [...document.querySelectorAll('a[href]')].filter((link) => {
        try {
          const url = new URL(link.href);
          return url.protocol !== 'https:'
            || !['x.com', 'threads.com', 'www.threads.com'].includes(url.hostname)
            || link.target !== '_blank'
            || !link.relList.contains('noopener')
            || !link.relList.contains('noreferrer');
        } catch {
          return true;
        }
      }).map((link) => link.getAttribute('href')),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    const [bothCount, xOnlyCount, threadsOnlyCount, totalCount] = initial.counts;
    await dashboard.click('[data-filter="x_only"]');
    await dashboard.waitForFunction(
      (expected) => document.querySelectorAll('.post-card:not([hidden])').length === expected,
      {},
      xOnlyCount,
    );
    const xOnlyVisible = await dashboard.$$eval('.post-card:not([hidden])', (nodes) => nodes.length);
    process.stdout.write(`${JSON.stringify({ initial, xOnlyVisible, externalRequests, browserErrors }, null, 2)}\n`);
    if (
      initial.title !== 'X・Threads 投稿比較' ||
      initial.counts.length !== 4 ||
      bothCount + xOnlyCount + threadsOnlyCount !== totalCount ||
      initial.cards !== totalCount ||
      initial.treeNodes < 2 ||
      initial.platformLinks < totalCount ||
      initial.partLinks < 2 ||
      initial.unsafeLinks.length > 0 ||
      initial.overflow ||
      xOnlyVisible !== xOnlyCount ||
      externalRequests.length > 0 ||
      browserErrors.length > 0
    ) process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});

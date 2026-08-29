#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.dirname(scriptDirectory);
const parentDirectory = path.dirname(projectDirectory);
const inputPath = process.argv[2] ?? path.join(parentDirectory, 'SNS横断ダッシュボード_X_Threads1ヶ月実データ版.html');
const screenshotPath = process.argv[3] ?? path.join(parentDirectory, 'SNS横断ダッシュボード_カレンダー_スマホQA.png');

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.setContent(await readFile(inputPath, 'utf8'), { waitUntil: 'domcontentloaded' });

  const initial = await page.evaluate(() => ({
    totalCards: document.querySelectorAll('.post-card').length,
    titleLinks: document.querySelectorAll('.post-title-link').length,
    postOpenLinks: document.querySelectorAll('a.post-open-link').length,
    months: [...document.querySelectorAll('[data-calendar-month]')]
      .map((node) => ({ month: node.dataset.calendarMonth, hidden: node.hidden })),
    markerElements: document.querySelectorAll('.calendar-marker').length,
    maxMarkersPerDay: Math.max(0, ...[...document.querySelectorAll('.calendar-day')]
      .map((day) => day.querySelectorAll('.calendar-marker').length)),
    august26: document.querySelector('[data-date="2026-08-26"]')?.innerText,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));

  const busyMarker = await page.$('[data-date="2026-08-26"] [data-calendar-groups]');
  if (!busyMarker) throw new Error('Expected an aggregated marker on 2026-08-26');
  const expectedVisible = await busyMarker.evaluate((node) => node.dataset.calendarGroups.split(' ').filter(Boolean).length);
  await busyMarker.click();
  const visibleAfterBusyMarker = await page.$$eval('.post-card:not([hidden])', (nodes) => nodes.length);
  await page.click('[data-filter="all"]');
  const visibleAfterReset = await page.$$eval('.post-card:not([hidden])', (nodes) => nodes.length);

  await page.click('[data-calendar-target="2026-07"]');
  const visibleMonthAfterSwitch = await page.$eval('.calendar-month:not([hidden])', (node) => node.dataset.calendarMonth);
  await page.click('[data-calendar-target="2026-08"]');
  const calendar = await page.$('.calendar-panel');
  if (!calendar) throw new Error('Calendar panel was not rendered');
  await calendar.screenshot({ path: screenshotPath, type: 'png' });

  const result = { initial, expectedVisible, visibleAfterBusyMarker, visibleAfterReset, visibleMonthAfterSwitch, screenshotPath };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    initial.totalCards !== 105
    || initial.titleLinks !== 0
    || initial.postOpenLinks < initial.totalCards
    || initial.months.length !== 2
    || initial.months.filter((month) => !month.hidden).length !== 1
    || initial.markerElements < 1
    || initial.maxMarkersPerDay > 3
    || initial.overflow
    || visibleAfterBusyMarker !== expectedVisible
    || visibleAfterReset !== initial.totalCards
    || visibleMonthAfterSwitch !== '2026-07'
  ) process.exitCode = 1;
} finally {
  await browser.close();
}

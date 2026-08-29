import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { generateDashboard } from '../scripts/generate-dashboard.mjs';

test('別ファイルのThreads表示回数を読み込み、比較JSONを上書きせずHTMLへ反映する', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sns-dashboard-'));
  const input = path.join(directory, 'comparison.json');
  const viewsInput = path.join(directory, 'threads-views.json');
  const output = path.join(directory, 'dashboard.html');
  await writeFile(input, JSON.stringify({
    period: { start_jst: '2026-08-01', end_jst: '2026-08-29' },
    captured_at: '2026-08-29T08:58:03.699Z',
    summary: { total_groups: 1, both: 0, x_only: 0, threads_only: 1 },
    limitations: ['Threadsの公開プロフィール一覧では表示数・ブックマーク数を確認できない'],
    rows: [{
      group_id: 'grp_001',
      text_preview: 'Threads投稿',
      representative_text: 'Threads投稿',
      presence_type: 'threads_only',
      x: null,
      threads: {
        post_id: 'ABC123',
        url: 'https://www.threads.com/@example/post/ABC123',
        posted_at: '2026-08-28T00:00:00Z',
        elapsed_hours: 32,
        likes: 1,
        replies: 0,
        reposts: 0,
        views: null,
        reactions_per_1000_followers: 1,
        unavailable_metrics: ['views', 'bookmarks'],
      },
    }],
  }));
  await writeFile(viewsInput, JSON.stringify({
    source_file: 'comparison.json',
    capture_method: 'public_post_detail_page',
    completed_at: '2026-08-29T12:34:56.000Z',
    summary: {
      attempted_count: 1,
      collected_count: 1,
      missing_count: 0,
      error_count: 0,
      approximate_count: 1,
    },
    results: [{
      group_id: 'grp_001',
      post_id: 'ABC123',
      url: 'https://www.threads.com/@example/post/ABC123',
      response_url: 'https://www.threads.com/@example/post/ABC123',
      payload_post_id: '123',
      status: 'ok',
      raw_text: '表示2.1万回',
      display: '2.1万',
      value: 21000,
      is_approximate: true,
      capture_source: 'visible_text',
      captured_at: '2026-08-29T12:34:00.000Z',
    }],
  }));

  await generateDashboard({ input, viewsInput, output });
  const html = await readFile(output, 'utf8');
  const unchanged = JSON.parse(await readFile(input, 'utf8'));
  assert.match(html, /<strong>2\.1万<\/strong>/);
  assert.match(html, /8\/29 21:34取得・概算/);
  assert.match(html, /Threads表示 1\/1件・8\/29 21:34取得/);
  assert.equal(unchanged.rows[0].threads.views, null);
});

test('途中収集・対象URL欠落のThreads artifactはHTMLへ合成しない', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sns-dashboard-incomplete-'));
  const input = path.join(directory, 'comparison.json');
  const viewsInput = path.join(directory, 'threads-views.json');
  const output = path.join(directory, 'dashboard.html');
  await writeFile(input, JSON.stringify({
    summary: { total_groups: 1, both: 0, x_only: 0, threads_only: 1 },
    rows: [{
      group_id: 'grp_001',
      text_preview: 'Threads投稿',
      representative_text: 'Threads投稿',
      presence_type: 'threads_only',
      x: null,
      threads: {
        post_id: 'ABC123',
        url: 'https://www.threads.com/@example/post/ABC123',
        posted_at: '2026-08-28T00:00:00Z',
      },
    }],
  }));
  await writeFile(viewsInput, JSON.stringify({
    source_file: 'comparison.json',
    capture_method: 'public_post_detail_page',
    completed_at: null,
    summary: { attempted_count: 0, collected_count: 0, missing_count: 0, error_count: 0, approximate_count: 0 },
    results: [],
  }));

  await assert.rejects(
    generateDashboard({ input, viewsInput, output }),
    /complete|coverage/i,
  );
});

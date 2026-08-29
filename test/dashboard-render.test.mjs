import assert from "node:assert/strict";
import { test } from "node:test";
import puppeteer from "puppeteer";

import { renderDashboard } from "../scripts/dashboard-template.mjs";

const sample = {
  period: { start_jst: "2026-07-30", end_jst: "2026-08-29" },
  captured_at: "2026-08-29T08:58:03.699Z",
  summary: {
    total_groups: 3,
    both: 1,
    x_only: 1,
    threads_only: 1,
    confirmed_matches: 1,
    candidate_matches: 0,
    by_match_method: { exact_text: 1, similar_text_and_time: 0, manual_review: 0 },
  },
  sources: [
    { platform: "X", follower_count_display: "5.4万", follower_count_approx: 54000 },
    { platform: "Threads", follower_count_display: "3.7万", follower_count_approx: 37000 },
  ],
  limitations: ["Threadsの公開プロフィール一覧では表示数を確認できない"],
  rows: [
    {
      group_id: "grp_001",
      text_preview: "両方にある投稿",
      representative_text: "両方にある投稿",
      presence_type: "both",
      match_method: "exact_text",
      match_status: "confirmed",
      x: {
        posted_at: "2026-08-28T00:00:00Z", elapsed_hours: 32.97, likes: 10, replies: 2,
        reposts: 3, views: 1000, bookmarks: 4, reactions: 15, reactions_per_1000_followers: 0.278,
        url: "https://x.com/example/status/1", unavailable_metrics: [],
        parts: [
          {
            kind: "root", label: "元投稿", part_number: 1, text: "両方にある投稿",
            posted_at: "2026-08-28T00:00:00Z", likes: 8, replies: 2, reposts: 3, views: 900,
            url: "https://x.com/example/status/1",
          },
          {
            kind: "self_reply", label: "リプライ1", part_number: 2, text: "Xの補足リプライ",
            posted_at: "2026-08-28T00:30:00Z", likes: 2, replies: 0, reposts: 0, views: 100,
            url: "https://x.com/example/status/11",
          },
        ],
      },
      threads: {
        posted_at: "2026-08-28T00:01:00Z", elapsed_hours: 32.95, likes: 20, replies: 3,
        reposts: 2, views: null, bookmarks: null, reactions: 25, reactions_per_1000_followers: 0.676,
        url: "https://www.threads.com/@example/post/1", unavailable_metrics: ["views", "bookmarks"],
        thread_status: "complete", expected_part_count: 2, collected_part_count: 2,
        parts: [
          {
            kind: "thread_part", label: "1/2", part_number: 1, text: "Threads前半",
            posted_at: "2026-08-28T00:01:00Z", likes: 12, replies: 2, reposts: 1, views: null,
            url: "https://www.threads.com/@example/post/1",
          },
          {
            kind: "thread_part", label: "2/2", part_number: 2, text: "Threads後半",
            posted_at: "2026-08-28T00:02:00Z", likes: 8, replies: 1, reposts: 1, views: null,
            url: "https://www.threads.com/@example/post/11",
          },
        ],
      },
    },
    {
      group_id: "grp_002",
      text_preview: "Xだけの投稿",
      representative_text: "Xだけの投稿",
      presence_type: "x_only",
      match_method: null,
      match_status: "unmatched",
      x: {
        posted_at: "2026-08-27T00:00:00Z", elapsed_hours: 56.97, likes: 5, replies: 0,
        reposts: 1, views: 500, bookmarks: 2, reactions: 6, reactions_per_1000_followers: 0.111,
        url: "https://x.com/example/status/2", unavailable_metrics: [],
      },
      threads: null,
    },
    {
      group_id: "grp_003",
      text_preview: "Threadsだけの投稿",
      representative_text: "Threadsだけの投稿",
      presence_type: "threads_only",
      match_method: null,
      match_status: "unmatched",
      x: null,
      threads: {
        posted_at: "2026-08-26T00:00:00Z", elapsed_hours: 80.97, likes: 8, replies: 1,
        reposts: 0, views: null, bookmarks: null, reactions: 9, reactions_per_1000_followers: 0.243,
        url: "https://www.threads.com/@example/post/2", unavailable_metrics: ["views", "bookmarks"],
      },
    },
  ],
};

test("実データの区分・取得不可・投稿なしを明示した自己完結HTMLを生成する", () => {
  const html = renderDashboard(sample);
  assert.match(html, /直近1か月分の取得データです/);
  assert.doesNotMatch(html, /1か月サンプル/);
  assert.match(html, /両方[\s\S]*1/);
  assert.match(html, /Xのみ[\s\S]*1/);
  assert.match(html, /Threadsのみ[\s\S]*1/);
  assert.match(html, /投稿なし/);
  assert.match(html, /取得不可/);
  assert.match(html, /フォロワー1,000人あたり/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
});

test("欠損値・類似照合・同率比較も壊さず表示する", () => {
  assert.throws(() => renderDashboard(null), /invalid/);
  const edge = {
    summary: { total_groups: 2, both: 2, x_only: 0, threads_only: 0 },
    captured_at: "invalid",
    rows: [
      {
        group_id: "edge-1",
        text_preview: "類似候補",
        representative_text: "類似候補",
        presence_type: "both",
        match_method: "similar_text_and_time",
        match_status: "candidate",
        x: { posted_at: "invalid", elapsed_hours: null, likes: null, replies: null, reposts: null, views: null, reactions_per_1000_followers: 1 },
        threads: { posted_at: "2026-08-29T08:40:00Z", elapsed_hours: 0.3, likes: 1, replies: 0, reposts: 0, views: null, reactions_per_1000_followers: 1 },
      },
      {
        group_id: "edge-2",
        text_preview: "目視確認",
        representative_text: "目視確認",
        presence_type: "both",
        match_method: "manual_review",
        match_status: "confirmed",
        x: { posted_at: "2026-08-29T08:00:00Z", elapsed_hours: 0.9, likes: 2, replies: 0, reposts: 0, views: 3, reactions_per_1000_followers: 2 },
        threads: { posted_at: "2026-08-29T08:01:00Z", elapsed_hours: 0.8, likes: 1, replies: 0, reposts: 0, views: null, reactions_per_1000_followers: 1 },
      },
    ],
  };
  const html = renderDashboard(edge);
  assert.match(html, /両方・類似照合/);
  assert.match(html, /目視確認済み/);
  assert.match(html, /投稿後 18分/);
  assert.match(html, /取得 —/);
  assert.match(html, /Xが上[\s\S]*1/);
});

test("XのセルフリプライとThreads分割投稿を同じカード内のツリーで表示し、各投稿へ移動できる", () => {
  const html = renderDashboard(sample);
  assert.match(html, /class="platform-link" href="https:\/\/x\.com\/example\/status\/1" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /class="platform-link" href="https:\/\/www\.threads\.com\/@example\/post\/1" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Xの補足リプライ/);
  assert.match(html, /Threads前半/);
  assert.match(html, /Threads後半/);
  assert.match(html, /リプライ1/);
  assert.match(html, /1\/2/);
  assert.match(html, /2\/2/);
  assert.match(html, /class="part-link" href="https:\/\/x\.com\/example\/status\/11" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /class="part-link" href="https:\/\/www\.threads\.com\/@example\/post\/11" target="_blank" rel="noopener noreferrer"/);
  assert.equal((html.match(/class="post-card"/g) ?? []).length, 3);
});

test("投稿タイトルと明示ボタンから各媒体の実投稿へ移動できる", () => {
  const html = renderDashboard(sample);
  assert.match(html, /<h2 class="post-copy"><a class="post-title-link" href="https:\/\/x\.com\/example\/status\/1" target="_blank" rel="noopener noreferrer">両方にある投稿<\/a><\/h2>/);
  assert.match(html, /class="post-open-link x" href="https:\/\/x\.com\/example\/status\/1" target="_blank" rel="noopener noreferrer">Xで投稿を見る/);
  assert.match(html, /class="post-open-link threads" href="https:\/\/www\.threads\.com\/@example\/post\/1" target="_blank" rel="noopener noreferrer">Threadsで投稿を見る/);
  assert.equal((html.match(/class="post-title-link"/g) ?? []).length, 3);
  assert.equal((html.match(/class="post-open-link x"/g) ?? []).length, 2);
  assert.equal((html.match(/class="post-open-link threads"/g) ?? []).length, 2);
});

test("投稿リンクは対応媒体のHTTPS URLだけを許可する", () => {
  const unsafe = structuredClone(sample);
  unsafe.rows[0].x.url = "javascript:alert(1)";
  unsafe.rows[0].x.parts[0].url = "https://evil.example/status/1";
  const html = renderDashboard(unsafe);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /evil\.example/i);
});

test("スマホ幅で区分フィルターと検索が動き、横にはみ出さない", async (t) => {
  const browser = await puppeteer.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.setContent(renderDashboard(sample), { waitUntil: "domcontentloaded" });

  await page.click('[data-filter="x_only"]');
  await page.waitForFunction(() => document.querySelectorAll(".post-card:not([hidden])").length === 1);
  assert.equal(await page.$eval(".post-card:not([hidden])", (node) => node.dataset.presence), "x_only");

  await page.click('[data-filter="all"]');
  await page.type("#post-search", "Threadsだけ");
  await page.waitForFunction(() => document.querySelectorAll(".post-card:not([hidden])").length === 1);
  assert.equal(await page.$eval(".post-card:not([hidden]) .post-copy", (node) => node.textContent), "Threadsだけの投稿");
  assert.equal(await page.$eval(".post-card:not([hidden]) .post-open-link", (node) => node.textContent.includes("Threadsで投稿を見る")), true);
  assert.equal(await page.$eval("html", (node) => node.scrollWidth <= node.clientWidth), true);

  await page.click('[data-filter="all"]');
  await page.$eval("#post-search", (node) => { node.value = ""; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.type("#post-search", "Xの補足リプライ");
  await page.waitForFunction(() => document.querySelectorAll(".post-card:not([hidden])").length === 1);
  assert.equal(await page.$eval(".post-card:not([hidden])", (node) => node.dataset.presence), "both");
  assert.equal(await page.$eval("html", (node) => node.scrollWidth <= node.clientWidth), true);
});

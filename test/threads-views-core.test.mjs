import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyThreadsViewResults,
  inspectThreadsPagePayload,
  parseThreadsViewText,
} from "../scripts/threads-views-core.mjs";

function dataScript(payload) {
  return `<script type="application/json" data-sjs>${JSON.stringify(payload)}</script>`;
}

function pagePayload({ mediaId = "123", routeId = "123", shortcode = "ABC123", views = 4543 } = {}) {
  const routePayload = {
    config: { enable_view_counts: false, ...(views === null ? {} : { view_counts: views }) },
    route: {
      queryName: "BarcelonaPermalinkMobilePostColumnPageQuery",
      variables: { postID: routeId },
    },
  };
  const mediaPayload = {
    result: {
      media: { pk: mediaId, code: shortcode },
      related: { pk: "999", code: "RELATED" },
    },
  };
  return `${dataScript(routePayload)}${dataScript(mediaPayload)}`;
}

test("Threads詳細画面の正確値と丸め表記を区別して数値化する", () => {
  assert.deepEqual(parseThreadsViewText("投稿本文\n表示9,824回\nログイン"), {
    raw_text: "表示9,824回",
    display: "9,824",
    value: 9824,
    is_approximate: false,
  });

  assert.deepEqual(parseThreadsViewText("スレッド\n表示2.1万回\n4610_hotel"), {
    raw_text: "表示2.1万回",
    display: "2.1万",
    value: 21000,
    is_approximate: true,
  });
});

test("表示回数がない画面はnull、異なる候補が複数ある画面は曖昧として拒否する", () => {
  assert.equal(parseThreadsViewText("4610_hotel\nいいね 10"), null);
  assert.throws(
    () => parseThreadsViewText("表示1,000回\n関連投稿\n表示2,000回"),
    /ambiguous/i,
  );
});

test("公開詳細ページ内で対象shortcodeとpermalink取得IDが一致した値だけを読める", () => {
  assert.deepEqual(
    inspectThreadsPagePayload(pagePayload(), "ABC123"),
    {
      post_id: "123",
      view_metric: {
        raw_text: "表示4,543回",
        display: "4,543",
        value: 4543,
        is_approximate: false,
      },
    },
  );
  assert.deepEqual(inspectThreadsPagePayload(pagePayload({ views: null }), "ABC123"), {
    post_id: "123",
    view_metric: null,
  });
  assert.throws(
    () => inspectThreadsPagePayload(pagePayload({ routeId: "456" }), "ABC123"),
    /does not match/i,
  );
  assert.throws(
    () => inspectThreadsPagePayload(pagePayload(), "OTHER"),
    /target.*not found/i,
  );
});

test("対象permalink routeと別のdata-sjsにある関連投稿の表示回数は採用しない", () => {
  const targetWithoutViews = pagePayload({ views: null });
  const unrelatedViews = dataScript({
    related: {
      pk: "999",
      code: "RELATED",
      enable_view_counts: true,
      view_counts: 777,
    },
  });

  assert.deepEqual(inspectThreadsPagePayload(`${targetWithoutViews}${unrelatedViews}`, "ABC123"), {
    post_id: "123",
    view_metric: null,
  });
});

test("取得成功分だけ比較JSONへ反映し、未取得指標からviewsだけを外す", () => {
  const data = {
    limitations: ["Threadsの公開プロフィール一覧では表示数・ブックマーク数を確認できない"],
    rows: [
      {
        group_id: "grp_001",
        threads: {
          url: "https://www.threads.com/@example/post/ABC123",
          views: null,
          bookmarks: null,
          unavailable_metrics: ["views", "bookmarks"],
        },
      },
      {
        group_id: "grp_002",
        threads: {
          url: "https://www.threads.com/@example/post/DEF456",
          views: null,
          unavailable_metrics: ["views"],
        },
      },
      {
        group_id: "grp_003",
        threads: {
          url: "https://www.threads.com/@example/post/GHI789",
          views: null,
          unavailable_metrics: ["views"],
        },
      },
    ],
  };
  const collectedAt = "2026-08-29T12:34:56.000Z";
  const result = applyThreadsViewResults(data, [
    {
      url: "https://www.threads.com/@example/post/ABC123",
      status: "ok",
      raw_text: "表示2.1万回",
      display: "2.1万",
      value: 21000,
      is_approximate: true,
      capture_source: "visible_text",
      captured_at: collectedAt,
    },
    {
      url: "https://www.threads.com/@example/post/DEF456",
      status: "missing",
      captured_at: collectedAt,
    },
    {
      url: "https://www.threads.com/@example/post/GHI789",
      status: "error",
      captured_at: collectedAt,
      error: "Threads response URL does not match",
    },
  ], { collectedAt });

  assert.equal(result.rows[0].threads.views, 21000);
  assert.equal(result.rows[0].threads.views_display, "2.1万");
  assert.equal(result.rows[0].threads.views_raw_text, "表示2.1万回");
  assert.equal(result.rows[0].threads.views_is_approximate, true);
  assert.equal(result.rows[0].threads.views_capture_method, "public_post_detail_ui_text");
  assert.deepEqual(result.rows[0].threads.unavailable_metrics, ["bookmarks"]);
  assert.equal(result.rows[1].threads.views, null);
  assert.equal(result.rows[1].threads.views_collection_status, "missing");
  assert.deepEqual(result.rows[1].threads.unavailable_metrics, ["views"]);
  assert.equal(result.rows[2].threads.views_collection_status, "error");
  assert.equal(result.rows[2].threads.views_collection_error, "Threads response URL does not match");
  assert.deepEqual(result.limitations, [
    "Threadsの表示回数は投稿詳細ページから追加取得。ブックマーク数は公開画面で確認できない",
  ]);
  assert.deepEqual(result.threads_views_enrichment, {
    collected_at: collectedAt,
    capture_method: "public_post_detail_page",
    attempted_count: 3,
    collected_count: 1,
    missing_count: 1,
    error_count: 1,
    approximate_count: 1,
  });
});

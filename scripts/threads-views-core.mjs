const VIEW_LINE = /^表示\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(万|億)?回$/u;

function normalizePostUrl(value) {
  const url = new URL(String(value ?? ''));
  if (url.protocol !== 'https:' || !['threads.com', 'www.threads.com'].includes(url.hostname)) {
    throw new Error(`Invalid Threads URL: ${value}`);
  }
  if (!/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error(`Invalid Threads post URL: ${value}`);
  }
  return `https://www.threads.com${url.pathname.replace(/\/$/, '')}`;
}

export function parseThreadsViewText(bodyText) {
  const candidates = String(bodyText ?? '')
    .split(/\r?\n/u)
    .map((line) => line.normalize('NFKC').trim())
    .filter((line) => VIEW_LINE.test(line));
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return null;
  if (unique.length > 1) throw new Error(`Ambiguous Threads view counts: ${unique.join(', ')}`);

  const rawText = unique[0];
  const match = VIEW_LINE.exec(rawText);
  if (!match) return null;
  const numberText = match[1];
  const unit = match[2] ?? '';
  const multiplier = unit === '億' ? 100_000_000 : unit === '万' ? 10_000 : 1;
  const value = Math.round(Number(numberText.replaceAll(',', '')) * multiplier);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Threads view count: ${rawText}`);

  return {
    raw_text: rawText,
    display: `${numberText}${unit}`,
    value,
    is_approximate: Boolean(unit),
  };
}

export function inspectThreadsPagePayload(payloadText, shortcode) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(shortcode ?? ''))) {
    throw new Error(`Invalid Threads shortcode: ${shortcode}`);
  }
  const scriptMatches = [...String(payloadText ?? '').matchAll(
    /<script\b(?=[^>]*\bdata-sjs\b)[^>]*>([\s\S]*?)<\/script>/giu,
  )];
  if (scriptMatches.length === 0) throw new Error('Threads data-sjs payload was not found');
  const roots = scriptMatches.map((match) => {
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`Threads data-sjs payload is invalid: ${error?.message ?? error}`);
    }
  });

  const mediaIds = new Set();
  const evidenceByRoot = roots.map((root) => {
    const routeIds = new Set();
    const viewCounts = new Set();
    const seen = new Set();
    const walk = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value.code === shortcode && /^\d+$/.test(String(value.pk ?? ''))) mediaIds.add(String(value.pk));
      if (value.queryName === 'BarcelonaPermalinkMobilePostColumnPageQuery'
        && /^\d+$/.test(String(value.variables?.postID ?? ''))) {
        routeIds.add(String(value.variables.postID));
      }
      if (Object.hasOwn(value, 'enable_view_counts') && Object.hasOwn(value, 'view_counts')) {
        if (!Number.isSafeInteger(value.view_counts) || value.view_counts < 0) {
          throw new Error(`Invalid Threads payload view count: ${value.view_counts}`);
        }
        viewCounts.add(value.view_counts);
      }
      for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
    };
    walk(root);
    return { routeIds, viewCounts };
  });

  const routeIds = new Set();
  for (const evidence of evidenceByRoot) {
    for (const routeId of evidence.routeIds) routeIds.add(routeId);
  }

  if (mediaIds.size === 0) throw new Error(`Target Threads post not found in payload: ${shortcode}`);
  if (mediaIds.size > 1) throw new Error(`Ambiguous target Threads media IDs: ${[...mediaIds].join(', ')}`);
  if (routeIds.size !== 1) throw new Error(`Ambiguous Threads permalink route IDs: ${[...routeIds].join(', ')}`);
  const postId = [...mediaIds][0];
  const routeId = [...routeIds][0];
  if (postId !== routeId) throw new Error(`Threads target media ID does not match permalink route ID: ${postId} != ${routeId}`);

  const boundViewCounts = new Set();
  for (const evidence of evidenceByRoot) {
    if (!evidence.routeIds.has(postId)) continue;
    for (const viewCount of evidence.viewCounts) boundViewCounts.add(viewCount);
  }
  if (boundViewCounts.size > 1) {
    throw new Error(`Ambiguous Threads payload view counts: ${[...boundViewCounts].join(', ')}`);
  }
  if (boundViewCounts.size === 0) return { post_id: postId, view_metric: null };

  const value = [...boundViewCounts][0];
  const display = new Intl.NumberFormat('ja-JP').format(value);
  return {
    post_id: postId,
    view_metric: {
      raw_text: `表示${display}回`,
      display,
      value,
      is_approximate: false,
    },
  };
}

function isValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validateThreadsViewArtifact(data, artifact, { sourceFile } = {}) {
  if (!data || !Array.isArray(data.rows) || !artifact || !Array.isArray(artifact.results)) {
    throw new Error('Threads views artifact is invalid');
  }
  if (artifact.capture_method !== 'public_post_detail_page') throw new Error('Threads views capture method is invalid');
  if (!isValidTimestamp(artifact.completed_at)) throw new Error('Threads views artifact is not complete');
  if (!sourceFile || artifact.source_file !== sourceFile) throw new Error('Threads views source file does not match');

  const expected = data.rows.filter((row) => row.threads?.url).map((row) => ({
    group_id: String(row.group_id),
    post_id: String(row.threads.post_id ?? row.threads.url.split('/').at(-1)),
    url: normalizePostUrl(row.threads.url),
  }));
  if (new Set(expected.map((entry) => entry.url)).size !== expected.length) {
    throw new Error('Threads source URL coverage is ambiguous');
  }
  if (artifact.results.length !== expected.length) {
    throw new Error(`Threads views coverage is incomplete: ${artifact.results.length}/${expected.length}`);
  }

  const resultsByUrl = new Map();
  for (const result of artifact.results) {
    const url = normalizePostUrl(result.url);
    if (resultsByUrl.has(url)) throw new Error(`Duplicate Threads result: ${url}`);
    resultsByUrl.set(url, result);
  }
  for (const entry of expected) {
    const result = resultsByUrl.get(entry.url);
    if (!result) throw new Error(`Threads views coverage is incomplete: ${entry.url}`);
    if (String(result.group_id) !== entry.group_id || String(result.post_id) !== entry.post_id) {
      throw new Error(`Threads result identity does not match: ${entry.url}`);
    }
    if (!['ok', 'missing', 'error'].includes(result.status) || !isValidTimestamp(result.captured_at)) {
      throw new Error(`Threads result status is invalid: ${entry.url}`);
    }
    if (result.status !== 'error') {
      if (normalizePostUrl(result.response_url) !== entry.url || !/^\d+$/.test(String(result.payload_post_id ?? ''))) {
        throw new Error(`Threads result payload binding is invalid: ${entry.url}`);
      }
    }
    if (result.status === 'ok') {
      if (!['visible_text', 'page_response_bound'].includes(result.capture_source)
        || !Number.isSafeInteger(result.value) || result.value < 0
        || typeof result.raw_text !== 'string' || typeof result.display !== 'string') {
        throw new Error(`Successful Threads result is invalid: ${entry.url}`);
      }
    }
  }

  const computed = {
    attempted_count: artifact.results.length,
    collected_count: artifact.results.filter((result) => result.status === 'ok').length,
    missing_count: artifact.results.filter((result) => result.status === 'missing').length,
    error_count: artifact.results.filter((result) => result.status === 'error').length,
    approximate_count: artifact.results.filter((result) => result.status === 'ok' && result.is_approximate).length,
  };
  for (const [key, value] of Object.entries(computed)) {
    if (artifact.summary?.[key] !== value) throw new Error(`Threads views summary does not match: ${key}`);
  }
  return computed;
}

export function applyThreadsViewResults(data, results, { collectedAt } = {}) {
  if (!data || !Array.isArray(data.rows) || !Array.isArray(results)) {
    throw new Error('Threads view enrichment input is invalid');
  }
  const copy = structuredClone(data);
  const resultByUrl = new Map();
  for (const result of results) {
    const normalizedUrl = normalizePostUrl(result.url);
    if (resultByUrl.has(normalizedUrl)) throw new Error(`Duplicate Threads result: ${normalizedUrl}`);
    resultByUrl.set(normalizedUrl, result);
  }

  for (const row of copy.rows) {
    if (!row.threads?.url) continue;
    const result = resultByUrl.get(normalizePostUrl(row.threads.url));
    if (!result) continue;
    row.threads.views_collection_status = result.status;
    if (result.status === 'error') row.threads.views_collection_error = result.error ?? 'Unknown collection error';
    if (result.status !== 'ok') continue;
    if (!Number.isSafeInteger(result.value) || result.value < 0 || !result.raw_text || !result.display) {
      throw new Error(`Invalid successful Threads result: ${row.threads.url}`);
    }
    delete row.threads.views_collection_error;
    row.threads.views = result.value;
    row.threads.views_display = result.display;
    row.threads.views_raw_text = result.raw_text;
    row.threads.views_is_approximate = Boolean(result.is_approximate);
    row.threads.views_captured_at = result.captured_at ?? collectedAt ?? null;
    row.threads.views_capture_method = result.capture_source === 'page_response_bound'
      ? 'public_post_detail_page_payload'
      : 'public_post_detail_ui_text';
    row.threads.unavailable_metrics = (row.threads.unavailable_metrics ?? [])
      .filter((metric) => metric !== 'views');
  }

  const effectiveCollectedAt = collectedAt
    ?? results.map((result) => result.captured_at).filter(Boolean).sort().at(-1)
    ?? null;
  copy.threads_views_enrichment = {
    collected_at: effectiveCollectedAt,
    capture_method: 'public_post_detail_page',
    attempted_count: results.length,
    collected_count: results.filter((result) => result.status === 'ok').length,
    missing_count: results.filter((result) => result.status === 'missing').length,
    error_count: results.filter((result) => result.status === 'error').length,
    approximate_count: results.filter((result) => result.status === 'ok' && result.is_approximate).length,
  };
  copy.limitations = (copy.limitations ?? []).map((limitation) => (
    limitation === 'Threadsの公開プロフィール一覧では表示数・ブックマーク数を確認できない'
      ? 'Threadsの表示回数は投稿詳細ページから追加取得。ブックマーク数は公開画面で確認できない'
      : limitation
  ));
  return copy;
}

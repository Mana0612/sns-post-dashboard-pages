function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('ja-JP').format(value) : '—';
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function jstDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function periodDates(data) {
  return {
    start: normalizeDateKey(data.period?.start_jst ?? data.period?.start_date),
    end: normalizeDateKey(data.period?.end_jst ?? data.period?.end_date),
  };
}

function postCardId(groupId) {
  const safe = String(groupId ?? '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `post-${safe || 'unknown'}`;
}

function formatElapsed(hours) {
  if (!Number.isFinite(hours)) return '経過時間不明';
  if (hours < 1) return `投稿後 ${Math.max(1, Math.round(hours * 60))}分`;
  if (hours < 48) return `投稿後 ${hours.toFixed(hours < 10 ? 1 : 0)}時間`;
  return `投稿後 ${(hours / 24).toFixed(hours < 168 ? 1 : 0)}日`;
}

function metric(label, value, { unavailableLabel = '取得不可', suffix = '' } = {}) {
  const available = Number.isFinite(value);
  return `<div class="metric">
    <span>${escapeHtml(label)}</span>
    <strong${available ? '' : ' class="unavailable"'}>${available ? `${formatNumber(value)}${suffix}` : '—'}</strong>
    ${available ? '' : `<small>${escapeHtml(unavailableLabel)}</small>`}
  </div>`;
}

function safePostUrl(platform, value) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:') return null;
    if (platform === 'x') {
      if (url.hostname !== 'x.com' || !/^\/[^/]+\/status\/\d+\/?$/.test(url.pathname)) return null;
    } else if (!['threads.com', 'www.threads.com'].includes(url.hostname)
      || !/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

function linkToPost(platform, url, label, className) {
  const safeUrl = safePostUrl(platform, url);
  if (!safeUrl) return `<span class="${className}">${escapeHtml(label)}</span>`;
  return `<a class="${className}" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}<span class="external-mark" aria-hidden="true">↗</span></a>`;
}

function renderPostLinks(row) {
  const links = [];
  if (row.x) links.push(linkToPost('x', row.x.url, 'Xで投稿を見る', 'post-open-link x'));
  if (row.threads) links.push(linkToPost('threads', row.threads.url, 'Threadsで投稿を見る', 'post-open-link threads'));
  return `<div class="post-links" aria-label="投稿へのリンク">${links.join('')}</div>`;
}

function partLabel(platform, post, part, index) {
  if (part.label) return part.label;
  if (platform === 'threads' && Number.isInteger(part.part_number) && Number.isInteger(post.expected_part_count)) {
    return `${part.part_number}/${post.expected_part_count}`;
  }
  if (part.kind === 'self_reply') return `リプライ${index}`;
  return index === 0 ? '元投稿' : `${index + 1}件目`;
}

function partCopy(text) {
  const value = String(text ?? '');
  if (value.length <= 220) return `<p class="part-copy">${escapeHtml(value)}</p>`;
  const preview = `${value.slice(0, 140).trim()}…`;
  return `<details class="part-copy-details">
    <summary>${escapeHtml(preview)}<span>全文を見る</span></summary>
    <p class="part-copy">${escapeHtml(value)}</p>
  </details>`;
}

function partMetric(label, value) {
  return Number.isFinite(value)
    ? `<span><small>${escapeHtml(label)}</small>${formatNumber(value)}</span>`
    : '';
}

function renderParts(platform, post) {
  if (!Array.isArray(post.parts) || post.parts.length < 2) return '';
  const incomplete = post.thread_status === 'incomplete';
  const childCount = platform === 'x'
    ? post.parts.filter((part) => part.kind === 'self_reply').length
    : post.parts.length;
  const description = platform === 'x'
    ? `本人リプライ ${formatNumber(childCount)}件を同じ投稿に統合`
    : `${formatNumber(post.parts.length)}件を1つのThreads投稿として表示`;
  const nodes = post.parts.map((part, index) => `<article class="thread-node" data-part-kind="${escapeHtml(part.kind ?? 'part')}">
    <div class="part-heading">
      ${linkToPost(platform, part.url, partLabel(platform, post, part, index), 'part-link')}
      <time>${escapeHtml(formatDateTime(part.posted_at))}</time>
    </div>
    ${partCopy(part.text)}
    <div class="part-metrics">
      ${partMetric('いいね', part.likes)}
      ${partMetric('返信', part.replies)}
      ${partMetric('再投稿', part.reposts)}
      ${partMetric('表示', part.views)}
    </div>
  </article>`).join('');
  return `<div class="thread-block">
    <div class="thread-caption"><span>${escapeHtml(description)}</span>${incomplete ? '<strong>一部未取得</strong>' : ''}</div>
    <div class="thread-tree">${nodes}</div>
  </div>`;
}

function platformPanel(platform, post) {
  const label = platform === 'x' ? 'X' : 'Threads';
  if (!post) {
    return `<section class="platform-panel platform-empty ${platform}">
      <div class="platform-heading"><span class="platform-mark">${label}</span></div>
      <div class="empty-copy"><strong>投稿なし</strong><span>この媒体には対応する投稿がありません</span></div>
    </section>`;
  }
  return `<section class="platform-panel ${platform}">
    <div class="platform-heading">
      ${linkToPost(platform, post.url, label, 'platform-link')}
      <span class="timing">${escapeHtml(formatElapsed(post.elapsed_hours))}</span>
    </div>
    <div class="posted-at">投稿日 ${escapeHtml(formatDateTime(post.posted_at))}</div>
    <div class="metrics">
      ${metric('いいね', post.likes)}
      ${metric('返信', post.replies)}
      ${metric('再投稿', post.reposts)}
      ${metric('表示', post.views, { unavailableLabel: '取得不可（画面非表示）' })}
      ${metric('1,000人あたり反応', post.reactions_per_1000_followers)}
    </div>
    ${renderParts(platform, post)}
  </section>`;
}

function presenceMeta(row) {
  if (row.presence_type === 'x_only') return { label: 'Xのみ', className: 'x-only' };
  if (row.presence_type === 'threads_only') return { label: 'Threadsのみ', className: 'threads-only' };
  if (row.match_status === 'candidate') return { label: '両方・類似照合', className: 'both candidate' };
  return { label: '両方・確認済み', className: 'both' };
}

function renderPostCard(row) {
  const presence = presenceMeta(row);
  const timestamp = Math.max(
    row.x ? Date.parse(row.x.posted_at) : Number.NEGATIVE_INFINITY,
    row.threads ? Date.parse(row.threads.posted_at) : Number.NEGATIVE_INFINITY,
  );
  const reactionScore = Math.max(
    row.x?.reactions_per_1000_followers ?? Number.NEGATIVE_INFINITY,
    row.threads?.reactions_per_1000_followers ?? Number.NEGATIVE_INFINITY,
  );
  const matchNote = row.match_method === 'manual_review'
    ? '目視確認済み'
    : row.match_method === 'exact_text'
      ? '本文一致'
      : row.match_method === 'similar_text_and_time'
        ? '本文と投稿時刻から照合'
        : '';
  const partTexts = [row.x, row.threads]
    .flatMap((post) => post?.parts?.map((part) => part.text) ?? [])
    .join(' ');
  const searchText = `${row.representative_text} ${partTexts} ${presence.label}`.toLowerCase();
  return `<article class="post-card" id="${postCardId(row.group_id)}" data-presence="${escapeHtml(row.presence_type)}" data-search="${escapeHtml(searchText)}" data-timestamp="${Number.isFinite(timestamp) ? timestamp : 0}" data-reaction="${Number.isFinite(reactionScore) ? reactionScore : -1}">
    <div class="post-topline">
      <span class="presence ${presence.className}">${escapeHtml(presence.label)}</span>
      ${matchNote ? `<span class="match-note">${escapeHtml(matchNote)}</span>` : ''}
    </div>
    <h2 class="post-copy">${escapeHtml(row.text_preview)}</h2>
    ${renderPostLinks(row)}
    <div class="platform-grid">
      ${platformPanel('x', row.x)}
      ${platformPanel('threads', row.threads)}
    </div>
  </article>`;
}

function monthKeysBetween(start, end) {
  if (!start || !end || start > end) return [];
  const result = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  for (let guard = 0; guard < 120 && (year < endYear || (year === endYear && month <= endMonth)); guard += 1) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return result;
}

function calendarMarkerGroups(rows) {
  const groups = new Map();
  const add = (date, kind, row) => {
    if (!date) return;
    const key = `${date}|${kind}`;
    if (!groups.has(key)) groups.set(key, { date, kind, posts: [] });
    groups.get(key).posts.push({
      id: postCardId(row.group_id),
      text: String(row.text_preview ?? row.representative_text ?? '投稿'),
    });
  };

  for (const row of rows) {
    const xDate = jstDateKey(row.x?.posted_at);
    const threadsDate = jstDateKey(row.threads?.posted_at);
    if (xDate && threadsDate && xDate === threadsDate) add(xDate, 'both', row);
    else {
      add(xDate, 'x', row);
      add(threadsDate, 'threads', row);
    }
  }
  return [...groups.values()];
}

function renderCalendarMarker(group) {
  const baseLabel = group.kind === 'both' ? '(X,T)' : group.kind === 'x' ? '(X)' : '(T)';
  const count = group.posts.length;
  const visibleLabel = count > 1 ? `${baseLabel}×${count}` : baseLabel;
  if (count === 1) {
    const post = group.posts[0];
    return `<a class="calendar-marker ${group.kind}" href="#${post.id}" aria-label="${escapeHtml(`${group.date} ${baseLabel} ${post.text}へ移動`)}">${escapeHtml(visibleLabel)}</a>`;
  }
  const ids = group.posts.map((post) => post.id).join(' ');
  return `<button class="calendar-marker ${group.kind}" type="button" data-calendar-groups="${escapeHtml(ids)}" aria-label="${escapeHtml(`${group.date} ${baseLabel} ${count}件を一覧表示`)}">${escapeHtml(visibleLabel)}</button>`;
}

function renderCalendar(data) {
  const bounds = periodDates(data);
  const markerGroups = calendarMarkerGroups(data.rows);
  const groupsByDate = new Map();
  for (const group of markerGroups) {
    if (!groupsByDate.has(group.date)) groupsByDate.set(group.date, []);
    groupsByDate.get(group.date).push(group);
  }
  const markerDates = markerGroups.map((group) => group.date).sort();
  const start = bounds.start ?? markerDates[0] ?? null;
  const end = bounds.end ?? markerDates.at(-1) ?? start;
  const months = monthKeysBetween(start, end);
  for (const date of markerDates) {
    const month = date.slice(0, 7);
    if (!months.includes(month)) months.push(month);
  }
  months.sort();
  const activeMonth = (bounds.end?.slice(0, 7) && months.includes(bounds.end.slice(0, 7)))
    ? bounds.end.slice(0, 7)
    : months.at(-1);
  const kindOrder = { both: 0, x: 1, threads: 2 };

  const tabs = months.map((month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const active = month === activeMonth;
    return `<button class="calendar-month-tab" type="button" data-calendar-target="${month}" aria-controls="calendar-${month}" aria-pressed="${active}">${year}年${monthNumber}月</button>`;
  }).join('');

  const panels = months.map((month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const leading = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const cells = Array.from({ length: leading }, () => '<div class="calendar-spacer" aria-hidden="true"></div>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const outside = (bounds.start && date < bounds.start) || (bounds.end && date > bounds.end);
      const markers = (groupsByDate.get(date) ?? [])
        .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind])
        .map(renderCalendarMarker)
        .join('');
      cells.push(`<div class="calendar-day${outside ? ' outside-period' : ''}" data-date="${date}"><span class="calendar-day-number">${day}</span>${outside ? '<span class="outside-label">期間外</span>' : markers}</div>`);
    }
    while (cells.length % 7) cells.push('<div class="calendar-spacer" aria-hidden="true"></div>');
    return `<section class="calendar-month" id="calendar-${month}" data-calendar-month="${month}"${month === activeMonth ? '' : ' hidden'} role="tabpanel">
      <div class="calendar-weekdays" aria-hidden="true"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
      <div class="calendar-grid">${cells.join('')}</div>
    </section>`;
  }).join('');

  return `<section class="calendar-panel" aria-label="投稿カレンダー">
    <div class="calendar-heading"><div><p class="section-kicker">POSTING CALENDAR</p><h2>投稿日カレンダー</h2></div><div class="calendar-tabs" role="tablist" aria-label="表示月">${tabs}</div></div>
    <p class="calendar-copy">同じ日にXとThreadsへ投稿した組は（X,T）、単独投稿は（X）または（T）で表示。連投・本人リプライは元投稿の日に1件として数えます。</p>
    ${panels}
    <div class="calendar-legend"><span class="both">（X,T）両方</span><span class="x">（X）Xのみ</span><span class="threads">（T）Threadsのみ</span></div>
    <p class="calendar-note">※（X,T）には確認済みの組と類似照合候補が含まれます。複数件の印を押すと該当投稿だけを一覧表示します。</p>
  </section>`;
}

function comparisonWins(rows) {
  const result = { x: 0, threads: 0, tie: 0, comparable: 0 };
  for (const row of rows) {
    const xValue = row.x?.reactions_per_1000_followers;
    const threadsValue = row.threads?.reactions_per_1000_followers;
    if (!Number.isFinite(xValue) || !Number.isFinite(threadsValue)) continue;
    result.comparable += 1;
    if (Math.abs(xValue - threadsValue) < 0.0005) result.tie += 1;
    else if (xValue > threadsValue) result.x += 1;
    else result.threads += 1;
  }
  return result;
}

export function renderDashboard(data) {
  if (!data?.summary || !Array.isArray(data.rows)) throw new Error('Dashboard data is invalid');
  const summary = data.summary;
  const wins = comparisonWins(data.rows.filter((row) => row.presence_type === 'both'));
  const xShare = wins.comparable ? (wins.x / wins.comparable) * 100 : 0;
  const threadsShare = wins.comparable ? (wins.threads / wins.comparable) * 100 : 0;
  const sourceByPlatform = Object.fromEntries((data.sources ?? []).map((source) => [source.platform, source]));
  const bounds = periodDates(data);
  const period = `${escapeHtml(bounds.start ?? '2026-07-30')} 〜 ${escapeHtml(bounds.end ?? '2026-08-29')}`;
  const calendar = renderCalendar(data);
  const cards = data.rows.map(renderPostCard).join('\n');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>X・Threads 投稿比較ダッシュボード</title>
<style>
:root{color-scheme:light;--ink:#15202b;--muted:#64717d;--soft:#f3f6f8;--line:#dde4e8;--white:#fff;--x:#111820;--threads:#6646d9;--both:#126b52;--warn:#9a5b00;--shadow:0 9px 28px rgba(28,46,58,.08)}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:#edf2f5}
body{min-width:0;margin:0;background:linear-gradient(180deg,#edf4f7 0,#f7f9fa 320px,#f7f9fa 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI","Yu Gothic",sans-serif;font-feature-settings:"palt";line-height:1.5}
button,input,select{font:inherit}
.shell{width:min(100%,1120px);margin:0 auto;padding:22px 16px 60px}
.hero{padding:10px 2px 18px}
.eyebrow{margin:0 0 5px;color:#26647a;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
h1{margin:0;font-size:clamp(25px,6vw,40px);line-height:1.18;letter-spacing:-.035em}
.subtitle{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.65}
.source-line{display:flex;flex-wrap:wrap;gap:7px 14px;margin-top:12px;color:#42505b;font-size:12px;font-variant-numeric:tabular-nums}
.source-pill{display:inline-flex;align-items:center;gap:6px}
.source-dot{width:8px;height:8px;border-radius:50%;background:var(--x)}
.source-dot.threads{background:var(--threads)}
.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.summary-card{min-width:0;padding:15px;border:1px solid rgba(20,37,49,.07);border-radius:17px;background:rgba(255,255,255,.94);box-shadow:var(--shadow)}
.summary-card span{display:block;color:var(--muted);font-size:11px;font-weight:700}
.summary-card strong{display:block;margin-top:1px;font-size:29px;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.summary-card.both strong{color:var(--both)}
.summary-card.x strong{color:var(--x)}
.summary-card.threads strong{color:var(--threads)}
.insight{margin-top:12px;padding:17px;border:1px solid rgba(20,37,49,.07);border-radius:17px;background:#fff;box-shadow:var(--shadow)}
.section-kicker{margin:0;color:#53616c;font-size:11px;font-weight:800;letter-spacing:.08em}
.insight h2{margin:4px 0 2px;font-size:18px;letter-spacing:-.02em}
.insight-copy{margin:0;color:var(--muted);font-size:12px}
.win-row{display:grid;grid-template-columns:76px 1fr 34px;align-items:center;gap:9px;margin-top:12px;font-size:12px;font-weight:700}
.bar{height:9px;overflow:hidden;border-radius:999px;background:#edf1f3}
.bar span{display:block;height:100%;min-width:2px;border-radius:inherit;background:var(--x)}
.win-row.threads .bar span{background:var(--threads)}
.win-count{text-align:right;font-variant-numeric:tabular-nums}
.definition{margin:13px 0 0;padding-top:12px;border-top:1px solid var(--line);color:#6b7780;font-size:11px;line-height:1.65}
.notice{margin-top:12px;padding:12px 14px;border-left:4px solid #d9a441;border-radius:8px 13px 13px 8px;background:#fff8e8;color:#634b19;font-size:11px;line-height:1.65}
.calendar-panel{margin-top:12px;padding:15px 10px 12px;border:1px solid rgba(19,36,48,.09);border-radius:18px;background:#fff;box-shadow:var(--shadow)}
.calendar-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;padding:0 4px}
.calendar-heading h2{margin:2px 0 0;font-size:18px;letter-spacing:-.02em}
.calendar-tabs{display:flex;flex:none;gap:5px}
.calendar-month-tab{min-height:32px;padding:5px 9px;border:1px solid var(--line);border-radius:9px;background:#f6f8f9;color:#58656e;font-size:10px;font-weight:800;cursor:pointer}
.calendar-month-tab[aria-pressed="true"]{border-color:#173848;background:#173848;color:#fff}
.calendar-month-tab:focus-visible,.calendar-marker:focus-visible{outline:3px solid rgba(39,114,140,.24);outline-offset:2px}
.calendar-copy{margin:8px 4px 11px;color:var(--muted);font-size:10px;line-height:1.65}
.calendar-month[hidden]{display:none}
.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.calendar-weekdays{margin-bottom:3px;color:#72808a;font-size:9px;font-weight:800;text-align:center}
.calendar-weekdays span:first-child{color:#b54b4b}
.calendar-weekdays span:last-child{color:#426fa2}
.calendar-day,.calendar-spacer{min-width:0;min-height:70px;border-radius:8px}
.calendar-day{display:flex;flex-direction:column;gap:3px;padding:4px 3px;border:1px solid #e4e9ec;background:#fbfcfd}
.calendar-day-number{align-self:flex-start;color:#53616b;font-size:9px;font-weight:850;font-variant-numeric:tabular-nums;line-height:1}
.calendar-day.outside-period{border-color:#eef1f3;background:#f4f6f7;color:#a5adb2}
.calendar-day.outside-period .calendar-day-number{color:#adb5ba}
.outside-label{margin:auto 0;color:#a5adb2;font-size:7px;text-align:center;white-space:nowrap}
.calendar-marker{display:block;width:100%;min-width:0;margin:0;padding:3px 1px;border:0;border-radius:5px;color:#fff;font-size:8px;font-weight:900;line-height:1.2;text-align:center;text-decoration:none;white-space:nowrap;cursor:pointer}
.calendar-marker.both{background:var(--both)}
.calendar-marker.x{background:var(--x)}
.calendar-marker.threads{background:var(--threads)}
.calendar-marker.is-active{box-shadow:0 0 0 3px rgba(217,164,65,.42)}
.calendar-legend{display:flex;flex-wrap:wrap;gap:5px 12px;margin:10px 4px 0;color:#596670;font-size:9px;font-weight:750}
.calendar-legend span::before{content:"";display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:2px;background:currentColor}
.calendar-legend .both{color:var(--both)}
.calendar-legend .x{color:var(--x)}
.calendar-legend .threads{color:var(--threads)}
.calendar-note{margin:6px 4px 0;color:#7b858d;font-size:8px;line-height:1.6}
.controls{position:sticky;z-index:5;top:0;margin:18px -16px 14px;padding:10px 16px 12px;border-bottom:1px solid rgba(30,45,54,.08);background:rgba(247,249,250,.94);backdrop-filter:blur(13px)}
.filters{display:flex;gap:7px;overflow:auto;padding-bottom:2px;scrollbar-width:none}
.filters::-webkit-scrollbar{display:none}
.filter{flex:none;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#42505b;font-size:12px;font-weight:750;cursor:pointer}
.filter[aria-pressed="true"]{border-color:#173848;background:#173848;color:#fff}
.tool-row{display:grid;grid-template-columns:1fr 118px;gap:8px;margin-top:9px}
.search-wrap{position:relative;min-width:0}
.search-wrap::before{content:"⌕";position:absolute;left:11px;top:50%;transform:translateY(-51%);color:#6e7b84;font-size:18px}
#post-search,.sort{width:100%;height:42px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);outline:none}
#post-search{padding:0 11px 0 34px}
.sort{padding:0 8px;font-size:12px}
#post-search:focus,.sort:focus{border-color:#27728c;box-shadow:0 0 0 3px rgba(39,114,140,.12)}
.result-line{display:flex;justify-content:space-between;gap:12px;margin:0 1px 9px;color:var(--muted);font-size:11px}
#result-count{font-weight:800;color:#34434d}
.post-list{display:grid;gap:12px}
.post-card{min-width:0;padding:15px;scroll-margin-top:116px;border:1px solid rgba(19,36,48,.09);border-radius:18px;background:#fff;box-shadow:0 7px 22px rgba(30,45,56,.055)}
.post-card[hidden]{display:none}
.post-topline{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.presence,.match-note{display:inline-flex;align-items:center;min-height:24px;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:800}
.presence.both{background:#e3f4ed;color:#0d654c}
.presence.candidate{background:#fff0d9;color:#8a5100}
.presence.x-only{background:#e9edf0;color:#17202a}
.presence.threads-only{background:#eee9ff;color:#5636c5}
.match-note{padding-inline:0;background:none;color:#7b858d;font-weight:650}
.post-copy{margin:9px 0 8px;font-size:14px;font-weight:720;line-height:1.65;overflow-wrap:anywhere}
.post-links{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 13px}
.post-open-link{display:inline-flex;min-height:34px;align-items:center;gap:5px;padding:6px 10px;border:1px solid var(--line);border-radius:9px;background:#f8fafb;color:#26343e;font-size:11px;font-weight:850;text-decoration:none}
.post-open-link.x{border-color:#cfd6da;background:#f1f3f4;color:#111820}
.post-open-link.threads{border-color:#ded5ff;background:#f3efff;color:#5636c5}
.post-open-link:hover{filter:brightness(.97)}
.post-open-link:focus-visible{outline:3px solid rgba(39,114,140,.24);outline-offset:2px}
.platform-grid{display:grid;gap:9px}
.platform-panel{min-width:0;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fbfcfd}
.platform-panel.x{border-top:3px solid var(--x)}
.platform-panel.threads{border-top:3px solid var(--threads)}
.platform-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.platform-mark,.platform-link{font-size:13px;font-weight:900}
.platform-link,.part-link{display:inline-flex;align-items:center;gap:4px;color:inherit;text-decoration:none;text-underline-offset:3px}
.platform-link:hover,.part-link:hover{text-decoration:underline}
.platform-link:focus-visible,.part-link:focus-visible{border-radius:5px;outline:3px solid rgba(39,114,140,.24);outline-offset:2px}
.external-mark{color:#78848d;font-size:.82em;font-weight:700}
.timing{color:#63707a;font-size:10px;font-variant-numeric:tabular-nums}
.posted-at{margin-top:2px;color:#7a858d;font-size:9px}
.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
.metric{min-width:0;padding:8px;border-radius:10px;background:#fff}
.metric span{display:block;overflow:hidden;color:#76818a;font-size:9px;font-weight:700;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
.metric strong{display:block;margin-top:1px;font-size:16px;line-height:1.25;font-variant-numeric:tabular-nums}
.metric strong.unavailable{color:#a0a8ae}
.metric small{display:block;color:#9a6a24;font-size:8px}
.thread-block{margin-top:11px;padding-top:10px;border-top:1px solid var(--line)}
.thread-caption{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;color:#596773;font-size:9px;font-weight:750}
.thread-caption strong{flex:none;padding:2px 6px;border-radius:999px;background:#fff1d9;color:#875000;font-size:8px}
.thread-tree{position:relative;display:grid;gap:8px;padding-left:15px}
.thread-tree::before{content:"";position:absolute;top:11px;bottom:11px;left:4px;width:2px;border-radius:999px;background:#d6dde2}
.thread-node{position:relative;min-width:0;padding:9px 9px 8px;border:1px solid #e3e8eb;border-radius:11px;background:#fff}
.thread-node::before{content:"";position:absolute;top:14px;left:-15px;width:9px;height:9px;border:2px solid #fff;border-radius:50%;background:var(--x);box-shadow:0 0 0 1px #cfd8dd}
.platform-panel.threads .thread-node::before{background:var(--threads)}
.part-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.part-link{font-size:10px;font-weight:850}
.part-heading time{flex:none;color:#879199;font-size:8px;font-variant-numeric:tabular-nums}
.part-copy{margin:6px 0 0;color:#34424c;font-size:10px;line-height:1.62;overflow-wrap:anywhere;white-space:pre-line}
.part-copy-details{margin-top:6px}
.part-copy-details summary{cursor:pointer;color:#34424c;font-size:10px;line-height:1.62;overflow-wrap:anywhere;list-style:none}
.part-copy-details summary::-webkit-details-marker{display:none}
.part-copy-details summary span{display:inline-flex;margin-left:5px;color:#2c7188;font-size:9px;font-weight:800;white-space:nowrap}
.part-copy-details[open] summary{display:none}
.part-metrics{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:7px;color:#394852;font-size:9px;font-variant-numeric:tabular-nums}
.part-metrics span{display:inline-flex;align-items:baseline;gap:3px;font-weight:750}
.part-metrics small{color:#879199;font-size:8px;font-weight:650}
.platform-empty{display:grid;min-height:132px;align-content:start}
.empty-copy{display:grid;place-items:center;align-self:center;gap:2px;padding:20px 8px;color:#8a949b;text-align:center}
.empty-copy strong{color:#596770;font-size:14px}
.empty-copy span{font-size:10px}
.empty-state{display:none;padding:34px 16px;border:1px dashed #bdc7cd;border-radius:16px;color:#68757e;text-align:center;font-size:13px}
.empty-state.visible{display:block}
.footnote{margin:22px 2px 0;color:#77828a;font-size:10px;line-height:1.7}
@media(min-width:680px){.shell{padding:34px 24px 76px}.summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.platform-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.calendar-panel{padding:18px}.calendar-day,.calendar-spacer{min-height:82px}.calendar-marker{font-size:9px}.controls{margin-inline:-24px;padding-inline:24px}.post-card{padding:19px}.post-copy{font-size:15px}}
@media(min-width:960px){.top-grid{display:grid;grid-template-columns:1.1fr .9fr;align-items:stretch;gap:12px}.insight{margin-top:0}.summary-grid{height:100%}.summary-card{display:grid;align-content:center}.metrics{grid-template-columns:repeat(5,minmax(0,1fr))}}
@media(max-width:360px){.tool-row{grid-template-columns:1fr}.sort{height:40px}.metrics{grid-template-columns:1fr 1fr}.summary-card{padding:13px}.summary-card strong{font-size:26px}.calendar-panel{padding-inline:7px}.calendar-heading{align-items:flex-start;flex-direction:column}.calendar-tabs{align-self:stretch}.calendar-month-tab{flex:1}.calendar-day,.calendar-spacer{min-height:66px}.calendar-grid,.calendar-weekdays{gap:2px}.calendar-marker{font-size:7.5px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.controls{backdrop-filter:none}}
</style>
</head>
<body>
<main class="shell">
  <header class="hero">
    <p class="eyebrow">POST PERFORMANCE SNAPSHOT</p>
    <h1>X・Threads 投稿比較</h1>
    <p class="subtitle">同じ内容の投稿を横に並べ、片方だけの投稿も分けて確認する直近1か月分の取得データです。</p>
    <div class="source-line">
      <span>${period}</span>
      <span>取得 ${escapeHtml(formatDateTime(data.captured_at))}</span>
      <span class="source-pill"><i class="source-dot"></i>X ${escapeHtml(sourceByPlatform.X?.follower_count_display ?? '—')}人</span>
      <span class="source-pill"><i class="source-dot threads"></i>Threads ${escapeHtml(sourceByPlatform.Threads?.follower_count_display ?? '—')}人</span>
    </div>
  </header>

  <div class="top-grid">
    <section class="summary-grid" aria-label="投稿区分の集計">
      <button class="summary-card both" type="button" data-summary-filter="both"><span>両方</span><strong>${formatNumber(summary.both)}</strong></button>
      <button class="summary-card x" type="button" data-summary-filter="x_only"><span>Xのみ</span><strong>${formatNumber(summary.x_only)}</strong></button>
      <button class="summary-card threads" type="button" data-summary-filter="threads_only"><span>Threadsのみ</span><strong>${formatNumber(summary.threads_only)}</strong></button>
      <button class="summary-card" type="button" data-summary-filter="all"><span>合計グループ</span><strong>${formatNumber(summary.total_groups)}</strong></button>
    </section>

    <section class="insight" aria-label="両方投稿の反応比較">
      <p class="section-kicker">両方投稿の比較</p>
      <h2>フォロワー1,000人あたりの共通反応</h2>
      <p class="insight-copy">いいね＋返信＋再投稿で比較できた ${formatNumber(wins.comparable)}件</p>
      <div class="win-row"><span>Xが上</span><div class="bar"><span style="width:${xShare.toFixed(2)}%"></span></div><span class="win-count">${formatNumber(wins.x)}</span></div>
      <div class="win-row threads"><span>Threadsが上</span><div class="bar"><span style="width:${threadsShare.toFixed(2)}%"></span></div><span class="win-count">${formatNumber(wins.threads)}</span></div>
      <p class="definition">共通反応＝いいね＋返信＋再投稿。表示回数はThreadsのプロフィール画面で確認できないため、媒体間比較には使っていません。</p>
    </section>
  </div>

  <div class="notice">これは1回取得した累計値のスナップショットです。投稿ごとに「投稿後何時間で取得したか」を表示しますが、成長曲線にするには同じ投稿を複数回取得する必要があります。</div>

  ${calendar}

  <section class="controls" aria-label="投稿の絞り込み">
    <div class="filters">
      <button class="filter" type="button" data-filter="all" aria-pressed="true">すべて ${formatNumber(summary.total_groups)}</button>
      <button class="filter" type="button" data-filter="both" aria-pressed="false">両方 ${formatNumber(summary.both)}</button>
      <button class="filter" type="button" data-filter="x_only" aria-pressed="false">Xのみ ${formatNumber(summary.x_only)}</button>
      <button class="filter" type="button" data-filter="threads_only" aria-pressed="false">Threadsのみ ${formatNumber(summary.threads_only)}</button>
    </div>
    <div class="tool-row">
      <label class="search-wrap"><span hidden>投稿本文を検索</span><input id="post-search" type="search" placeholder="投稿本文を検索" autocomplete="off"></label>
      <label><span hidden>並び順</span><select class="sort" id="post-sort"><option value="newest">新しい順</option><option value="reaction">反応率順</option></select></label>
    </div>
  </section>

  <div class="result-line"><span id="result-count">${formatNumber(summary.total_groups)}件を表示</span><span>数値は取得時点</span></div>
  <section class="post-list" id="post-list" aria-label="投稿比較一覧">${cards}</section>
  <div class="empty-state" id="empty-state">条件に合う投稿はありません。</div>

  <p class="footnote">照合内訳：本文一致 ${formatNumber(summary.by_match_method?.exact_text ?? 0)}件／本文と投稿時刻による類似照合 ${formatNumber(summary.by_match_method?.similar_text_and_time ?? 0)}件／目視確認 ${formatNumber(summary.by_match_method?.manual_review ?? 0)}件。類似照合は完全一致ではありません。Threadsの分割投稿とXの本人リプライは、同じ投稿カード内のツリーとしてまとめています。</p>
</main>
<script>
(() => {
  'use strict';
  const cards = [...document.querySelectorAll('.post-card')];
  const list = document.querySelector('#post-list');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const summaryFilters = [...document.querySelectorAll('[data-summary-filter]')];
  const calendarTabs = [...document.querySelectorAll('[data-calendar-target]')];
  const calendarMonths = [...document.querySelectorAll('[data-calendar-month]')];
  const calendarGroupButtons = [...document.querySelectorAll('[data-calendar-groups]')];
  const calendarPostLinks = [...document.querySelectorAll('.calendar-marker[href^="#post-"]')];
  const search = document.querySelector('#post-search');
  const sort = document.querySelector('#post-sort');
  const count = document.querySelector('#result-count');
  const empty = document.querySelector('#empty-state');
  let activeFilter = 'all';
  let calendarGroupFilter = null;

  function apply() {
    const query = search.value.normalize('NFKC').trim().toLowerCase();
    const ordered = [...cards].sort((left, right) => {
      const key = sort.value === 'reaction' ? 'reaction' : 'timestamp';
      return Number(right.dataset[key]) - Number(left.dataset[key]);
    });
    let visible = 0;
    for (const card of ordered) {
      const matchesType = activeFilter === 'all' || card.dataset.presence === activeFilter;
      const matchesQuery = !query || card.dataset.search.includes(query);
      const matchesCalendar = !calendarGroupFilter || calendarGroupFilter.has(card.id);
      card.hidden = !(matchesType && matchesQuery && matchesCalendar);
      if (!card.hidden) visible += 1;
      list.append(card);
    }
    count.textContent = visible.toLocaleString('ja-JP') + '件を表示';
    empty.classList.toggle('visible', visible === 0);
    for (const button of filters) button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
  }

  function clearCalendarGroupFilter() {
    calendarGroupFilter = null;
    for (const marker of calendarGroupButtons) marker.classList.remove('is-active');
  }

  function selectFilter(value) {
    clearCalendarGroupFilter();
    activeFilter = value;
    apply();
    document.querySelector('.controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectCalendarMonth(value) {
    for (const month of calendarMonths) month.hidden = month.dataset.calendarMonth !== value;
    for (const button of calendarTabs) button.setAttribute('aria-pressed', String(button.dataset.calendarTarget === value));
  }

  for (const button of calendarTabs) button.addEventListener('click', () => selectCalendarMonth(button.dataset.calendarTarget));
  for (const button of calendarGroupButtons) button.addEventListener('click', () => {
    clearCalendarGroupFilter();
    calendarGroupFilter = new Set(button.dataset.calendarGroups.split(' ').filter(Boolean));
    button.classList.add('is-active');
    activeFilter = 'all';
    search.value = '';
    apply();
    document.querySelector('.controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  for (const link of calendarPostLinks) link.addEventListener('click', () => {
    clearCalendarGroupFilter();
    activeFilter = 'all';
    search.value = '';
    apply();
  });
  for (const button of filters) button.addEventListener('click', () => { clearCalendarGroupFilter(); activeFilter = button.dataset.filter; apply(); });
  for (const button of summaryFilters) button.addEventListener('click', () => selectFilter(button.dataset.summaryFilter));
  search.addEventListener('input', apply);
  sort.addEventListener('change', apply);
  apply();
})();
</script>
</body>
</html>`;
}

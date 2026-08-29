const ADDITIONAL_DATA = "sns-post-dashboard-pages:v1";

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEncryptedPage(
  payload,
  { title = "SNS投稿ダッシュボード" } = {},
) {
  const escapedTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src blob:; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapedTitle}</title>
<style>
:root{color-scheme:light;--ink:#17202a;--muted:#66717d;--line:#dfe5ea;--surface:#fff;--bg:#f3f6f8;--blue:#0b4f82;--danger:#b42318}
*{box-sizing:border-box}
html,body{width:100%;min-height:100%;margin:0}
body{display:grid;place-items:center;min-height:100vh;min-height:100dvh;padding:24px;background:radial-gradient(circle at 12% 0%,#dcebf5 0,transparent 42%),var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI","Yu Gothic",sans-serif}
.gate{width:min(100%,390px);padding:28px;border:1px solid rgba(23,32,42,.08);border-radius:22px;background:rgba(255,255,255,.94);box-shadow:0 22px 70px rgba(28,48,64,.14)}
.mark{display:grid;place-items:center;width:46px;height:46px;margin-bottom:18px;border-radius:14px;background:#e8f2f8;color:var(--blue);font-size:22px}
.eyebrow{margin:0 0 5px;color:var(--blue);font-size:11px;font-weight:800;letter-spacing:.12em}
h1{margin:0;font-size:25px;line-height:1.25;letter-spacing:-.025em}
.lead{margin:10px 0 22px;color:var(--muted);font-size:14px;line-height:1.65}
label{display:block;margin-bottom:7px;font-size:13px;font-weight:700}
.field{display:flex;gap:8px}
input{width:100%;height:48px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font:inherit;font-variant-numeric:tabular-nums;outline:none}
input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(11,79,130,.12)}
button{flex:none;height:48px;padding:0 18px;border:0;border-radius:12px;background:var(--blue);color:#fff;font:inherit;font-weight:800;cursor:pointer}
button:disabled{cursor:wait;opacity:.65}
#status{min-height:20px;margin:10px 1px 0;color:var(--muted);font-size:12px}
#status.error{color:var(--danger)}
.privacy{margin:14px 1px 0;color:#7c8791;font-size:10px;line-height:1.55}
#dashboard-frame{position:fixed;z-index:10;inset:0;width:100%;height:100%;border:0;background:#fff}
body.unlocked{display:block;overflow:hidden;padding:0;background:#fff}
body.unlocked .gate{display:none}
@media(max-width:480px){body{align-items:end;padding:16px}.gate{padding:23px;border-radius:19px}.field{display:block}button{width:100%;margin-top:9px}h1{font-size:23px}}
</style>
</head>
<body>
<main class="gate">
  <div class="mark" aria-hidden="true">🔒</div>
  <p class="eyebrow">PRIVATE VIEW</p>
  <h1>${escapedTitle}</h1>
  <p class="lead">共有されたパスワードを入力すると、ダッシュボードを表示します。</p>
  <form id="unlock-form">
    <label for="password">パスワード</label>
    <div class="field">
      <input id="password" name="password" type="password" inputmode="numeric" autocomplete="current-password" maxlength="64" required autofocus>
      <button type="submit">開く</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
  </form>
  <p class="privacy">入力内容は外部へ送信されません。このページ内で暗号化データを復号します。</p>
</main>
<iframe id="dashboard-frame" title="SNS投稿ダッシュボード" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" hidden></iframe>
<script id="encrypted-payload" type="application/json">${safeJson(payload)}</script>
<script>
(() => {
  "use strict";
  const additionalData = ${JSON.stringify(ADDITIONAL_DATA)};
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const form = document.querySelector("#unlock-form");
  const input = document.querySelector("#password");
  const button = form.querySelector("button[type=submit]");
  const status = document.querySelector("#status");
  const frame = document.querySelector("#dashboard-frame");
  const payload = JSON.parse(document.querySelector("#encrypted-payload").textContent);
  let failures = 0;
  let busy = false;

  function bytesFromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function deriveKey(password) {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: payload.kdf.hash,
        iterations: payload.kdf.iterations,
        salt: bytesFromBase64(payload.kdf.salt),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  }

  async function decrypt(password) {
    const key = await deriveKey(password);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesFromBase64(payload.cipher.iv),
        additionalData: encoder.encode(additionalData),
        tagLength: 128,
      },
      key,
      bytesFromBase64(payload.cipher.ciphertext),
    );
    return decoder.decode(plaintext);
  }

  function showDashboard(html) {
    const objectUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    frame.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
    frame.src = objectUrl;
    frame.hidden = false;
    document.body.classList.add("unlocked");
    input.value = "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!globalThis.crypto?.subtle) {
      status.className = "error";
      status.textContent = "このブラウザでは暗号化機能を利用できません。HTTPSのURLで開いてください。";
      return;
    }
    busy = true;
    button.disabled = true;
    status.className = "";
    status.textContent = "確認しています…";
    try {
      const html = await decrypt(input.value);
      showDashboard(html);
    } catch {
      failures += 1;
      input.value = "";
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, failures * 250)));
      status.className = "error";
      status.textContent = "パスワードが違います。もう一度お試しください。";
      input.focus();
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
})();
</script>
</body>
</html>
`;
}

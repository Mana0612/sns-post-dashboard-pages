import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const docsDirectory = path.join(projectRoot, "docs");

test("GitHub Pagesの公開対象は暗号化HTMLと.nojekyllだけ", async () => {
  const files = (await readdir(docsDirectory)).sort();
  assert.deepEqual(files, [".nojekyll", "index.html"]);

  const html = await readFile(path.join(docsDirectory, "index.html"), "utf8");
  assert.equal((html.match(/<!doctype\s+html/gi) ?? []).length, 1);
  assert.equal((html.match(/<html(?:\s|>)/gi) ?? []).length, 1);
  assert.match(html, /id="encrypted-payload" type="application\/json"/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//i);

  const match = html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, "暗号化payloadを検出できること");
  const payload = JSON.parse(match[1]);
  assert.deepEqual(Object.keys(payload).sort(), ["cipher", "kdf", "version"]);
  assert.equal(typeof payload.cipher?.ciphertext, "string");
  assert.ok(payload.cipher.ciphertext.length > 100_000);
});

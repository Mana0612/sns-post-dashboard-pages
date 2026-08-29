import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { decryptHtml } from "../scripts/crypto-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const fixturePath = path.join(here, "fixtures", "sample-dashboard.html");
const TEST_PASSWORD = "integration-test-password";

function runBuild({ input, output, password }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(projectRoot, "scripts", "encrypt-page.mjs"),
      "--input",
      input,
      "--output",
      output,
      "--password-stdin",
    ], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
    child.stdin.end(`${password}\n`);
  });
}

function embeddedPayload(html) {
  const match = html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, "暗号化payloadがHTMLに埋め込まれていること");
  return JSON.parse(match[1]);
}

test("単一の公開用HTMLを生成し、平文とパスワードを残さない", async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "sns-dashboard-encryption-test-"));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const outputPath = path.join(tempDirectory, "index.html");

  const result = await runBuild({
    input: fixturePath,
    output: outputPath,
    password: TEST_PASSWORD,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes(TEST_PASSWORD), false);

  const outputHtml = await readFile(outputPath, "utf8");
  assert.match(outputHtml, /パスワードを入力/);
  assert.match(outputHtml, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(outputHtml, /allow-same-origin/);
  assert.equal(outputHtml.includes("PLAINTEXT_SENTINEL_7f3c"), false);
  assert.equal(outputHtml.includes(TEST_PASSWORD), false);

  const decrypted = await decryptHtml(embeddedPayload(outputHtml), TEST_PASSWORD);
  const source = await readFile(fixturePath, "utf8");
  assert.equal(decrypted, source);
});

test("パスワードをCLI引数で渡そうとすると拒否する", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(projectRoot, "scripts", "encrypt-page.mjs"),
      "--input",
      fixturePath,
      "--output",
      path.join(projectRoot, "never-created.html"),
      "--password",
      "do-not-accept-this",
    ], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /password-stdin/);
});

test("入力HTMLと出力先が同じパスなら元ファイルを上書きせず拒否する", async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "sns-dashboard-overwrite-test-"));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const samePath = path.join(tempDirectory, "source.html");
  await copyFile(fixturePath, samePath);
  const original = await readFile(samePath, "utf8");

  const result = await runBuild({
    input: samePath,
    output: samePath,
    password: TEST_PASSWORD,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /must be different/i);
  assert.equal(await readFile(samePath, "utf8"), original);
});

test("helpはパスワードなしで利用できる", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(projectRoot, "scripts", "encrypt-page.mjs"),
      "--help",
    ], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /--password-stdin/);
});

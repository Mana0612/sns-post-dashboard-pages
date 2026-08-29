import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const fixturePath = path.join(here, "fixtures", "sample-dashboard.html");
const TEST_PASSWORD = "browser-test-password";

function buildEncryptedPage(outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(projectRoot, "scripts", "encrypt-page.mjs"),
      "--input",
      fixturePath,
      "--output",
      outputPath,
      "--password-stdin",
    ], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    child.stdin.end(`${TEST_PASSWORD}\n`);
  });
}

async function startServer(html) {
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    url: `http://127.0.0.1:${address.port}/`,
  };
}

test("スマホ幅で誤入力を拒否し、正しい入力後だけダッシュボードを表示する", async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "sns-dashboard-browser-test-"));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const outputPath = path.join(tempDirectory, "index.html");
  await buildEncryptedPage(outputPath);
  const server = await startServer(await readFile(outputPath, "utf8"));
  t.after(server.close);

  const browser = await puppeteer.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const externalRequests = [];
  const browserErrors = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(server.url) && !url.startsWith("blob:") && !url.startsWith("data:")) {
      externalRequests.push(url);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(server.url, { waitUntil: "domcontentloaded" });

  assert.equal(await page.$eval("h1", (node) => node.textContent), "SNS投稿ダッシュボード");
  assert.equal((await page.content()).includes("PLAINTEXT_SENTINEL_7f3c"), false);

  await page.type("#password", "wrong-password");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("違います"));
  assert.equal(await page.$eval("#dashboard-frame", (node) => !node.hidden), false);

  await page.type("#password", TEST_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => document.body.classList.contains("unlocked"));
  await page.waitForFunction(() => {
    const frame = document.querySelector("#dashboard-frame");
    return frame && !frame.hidden;
  });

  const dashboardFrame = page.frames().find((frame) => frame !== page.mainFrame());
  await dashboardFrame.waitForSelector("#sample-dashboard");
  assert.equal(await dashboardFrame.$eval("h1", (node) => node.textContent), "Dashboard sample");
  assert.equal(await page.$eval("html", (node) => node.scrollWidth <= node.clientWidth), true);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(browserErrors, []);

  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.$eval("h1", (node) => node.textContent), "SNS投稿ダッシュボード");
  assert.equal(await page.$eval("#dashboard-frame", (node) => node.hidden), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ITERATIONS,
  decryptHtml,
  encryptHtml,
} from "../scripts/crypto-core.mjs";

const TEST_PASSWORD = "test-only-password";
const SAMPLE_HTML = "<!doctype html><h1>secret dashboard</h1>";

test("AES-GCM/PBKDF2で暗号化したHTMLを同じパスワードで復号できる", async () => {
  const payload = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);
  const decrypted = await decryptHtml(payload, TEST_PASSWORD);

  assert.equal(decrypted, SAMPLE_HTML);
  assert.equal(payload.kdf.iterations, DEFAULT_ITERATIONS);
  assert.equal(payload.kdf.hash, "SHA-256");
  assert.equal(payload.cipher.name, "AES-GCM");
});

test("誤ったパスワードでは復号できない", async () => {
  const payload = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);

  await assert.rejects(() => decryptHtml(payload, "wrong-password"));
});

test("同じHTMLとパスワードでもsaltとIVが毎回変わる", async () => {
  const first = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);
  const second = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);

  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.cipher.ciphertext, second.cipher.ciphertext);
});

test("空のパスワードと不正な反復回数を拒否する", async () => {
  await assert.rejects(() => encryptHtml(SAMPLE_HTML, ""), /password/i);
  await assert.rejects(() => encryptHtml(SAMPLE_HTML, "a".repeat(65)), /password/i);
  await assert.rejects(
    () => encryptHtml(SAMPLE_HTML, TEST_PASSWORD, { iterations: 10 }),
    /iterations/i,
  );
});

test("暗号化payloadに平文HTMLとパスワードを含めない", async () => {
  const payload = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);
  const serialized = JSON.stringify(payload);

  assert.equal(serialized.includes("secret dashboard"), false);
  assert.equal(serialized.includes(TEST_PASSWORD), false);
});

test("暗号文を1bit変更すると認証に失敗する", async () => {
  const payload = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);
  const tampered = structuredClone(payload);
  const ciphertext = Buffer.from(tampered.cipher.ciphertext, "base64");
  ciphertext[0] ^= 1;
  tampered.cipher.ciphertext = ciphertext.toString("base64");

  await assert.rejects(() => decryptHtml(tampered, TEST_PASSWORD));
});

test("不正なpayload形式を拒否する", async () => {
  const payload = await encryptHtml(SAMPLE_HTML, TEST_PASSWORD);
  await assert.rejects(
    () => decryptHtml({ ...payload, version: 99 }, TEST_PASSWORD),
    /version/i,
  );
  await assert.rejects(
    () => decryptHtml({ ...payload, kdf: { ...payload.kdf, salt: "not base64" } }, TEST_PASSWORD),
    /base64/i,
  );
});

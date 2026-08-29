import { webcrypto } from "node:crypto";

export const DEFAULT_ITERATIONS = 600_000;
export const PAYLOAD_VERSION = 1;

const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ADDITIONAL_DATA = "sns-post-dashboard-pages:v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function assertPassword(password) {
  if (typeof password !== "string" || password.length === 0 || password.length > 64) {
    throw new TypeError("password must be a non-empty string of at most 64 characters");
  }
}

function assertIterations(iterations) {
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new RangeError(`iterations must be an integer between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}`);
  }
}

function assertBytes(value, expectedLength, label) {
  if (!(value instanceof Uint8Array) || value.byteLength !== expectedLength) {
    throw new TypeError(`${label} must be a ${expectedLength}-byte Uint8Array`);
  }
}

function toBase64(value) {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TypeError(`${label} must be valid base64`);
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function deriveKey(password, salt, iterations, usages, cryptoImplementation) {
  const keyMaterial = await cryptoImplementation.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoImplementation.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function randomBytes(length, cryptoImplementation) {
  return cryptoImplementation.getRandomValues(new Uint8Array(length));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("encrypted payload must be an object");
  }
  if (payload.version !== PAYLOAD_VERSION) throw new TypeError("unsupported payload version");
  if (payload.kdf?.name !== "PBKDF2" || payload.kdf?.hash !== "SHA-256") {
    throw new TypeError("unsupported key derivation settings");
  }
  if (payload.cipher?.name !== "AES-GCM") throw new TypeError("unsupported cipher settings");
  assertIterations(payload.kdf.iterations);
  const salt = fromBase64(payload.kdf.salt, "salt");
  const iv = fromBase64(payload.cipher.iv, "iv");
  const ciphertext = fromBase64(payload.cipher.ciphertext, "ciphertext");
  assertBytes(salt, SALT_BYTES, "salt");
  assertBytes(iv, IV_BYTES, "iv");
  if (ciphertext.byteLength < 17) throw new TypeError("ciphertext is too short");
  return { ciphertext, iv, salt };
}

export async function encryptHtml(
  html,
  password,
  {
    cryptoImplementation = webcrypto,
    iterations = DEFAULT_ITERATIONS,
    iv = randomBytes(IV_BYTES, cryptoImplementation),
    salt = randomBytes(SALT_BYTES, cryptoImplementation),
  } = {},
) {
  if (typeof html !== "string" || html.length === 0) {
    throw new TypeError("html must be a non-empty string");
  }
  assertPassword(password);
  assertIterations(iterations);
  assertBytes(salt, SALT_BYTES, "salt");
  assertBytes(iv, IV_BYTES, "iv");

  const key = await deriveKey(password, salt, iterations, ["encrypt"], cryptoImplementation);
  const encrypted = await cryptoImplementation.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(ADDITIONAL_DATA),
      tagLength: 128,
    },
    key,
    encoder.encode(html),
  );

  return {
    version: PAYLOAD_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: toBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(encrypted)),
    },
  };
}

export async function decryptHtml(
  payload,
  password,
  { cryptoImplementation = webcrypto } = {},
) {
  assertPassword(password);
  const { ciphertext, iv, salt } = validatePayload(payload);
  const key = await deriveKey(
    password,
    salt,
    payload.kdf.iterations,
    ["decrypt"],
    cryptoImplementation,
  );
  const decrypted = await cryptoImplementation.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(ADDITIONAL_DATA),
      tagLength: 128,
    },
    key,
    ciphertext,
  );
  return decoder.decode(decrypted);
}

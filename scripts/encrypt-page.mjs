#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DEFAULT_ITERATIONS, encryptHtml } from "./crypto-core.mjs";
import { renderEncryptedPage } from "./page-template.mjs";

function usage() {
  return [
    "Usage: node scripts/encrypt-page.mjs --input <source.html> --output <index.html> --password-stdin [--iterations <number>]",
    "",
    "The password is read from stdin and is never accepted as a command-line argument.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { iterations: DEFAULT_ITERATIONS, passwordStdin: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--password" || argument.startsWith("--password=")) {
      throw new Error(`Passwords must not be passed on the command line. Use --password-stdin.\n${usage()}`);
    }
    if (argument === "--password-stdin") {
      options.passwordStdin = true;
      continue;
    }
    if (!["--input", "--output", "--iterations"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.\n${usage()}`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.input || !options.output || !options.passwordStdin) {
    throw new Error(`--input, --output, and --password-stdin are required.\n${usage()}`);
  }
  const iterations = Number(options.iterations);
  if (!Number.isSafeInteger(iterations)) throw new Error("--iterations must be an integer");
  return { ...options, iterations };
}

function readPasswordFromTerminal() {
  return new Promise((resolve, reject) => {
    let value = "";
    const stdin = process.stdin;
    const finish = (error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Password input was cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stderr.write("Enter page password: ");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readPassword() {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    const password = await readPasswordFromTerminal();
    if (!password) throw new Error("No password was provided on stdin");
    return password;
  }
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  const password = value.replace(/\r?\n$/, "");
  if (!password) throw new Error("No password was provided on stdin");
  if (/\r|\n/.test(password)) throw new Error("Password must be a single line");
  return password;
}

export async function buildEncryptedPage({ inputPath, iterations, outputPath, password }) {
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  if (resolvedInputPath === resolvedOutputPath) {
    throw new Error("Input and output paths must be different");
  }
  const sourceHtml = await readFile(resolvedInputPath, "utf8");
  const payload = await encryptHtml(sourceHtml, password, { iterations });
  const outputHtml = renderEncryptedPage(payload);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const temporaryPath = `${resolvedOutputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, outputHtml, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, resolvedOutputPath);
  return resolvedOutputPath;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.output);
  const password = await readPassword();
  await buildEncryptedPage({
    inputPath,
    iterations: options.iterations,
    outputPath,
    password,
  });
  process.stdout.write(`Generated encrypted page: ${outputPath}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  run().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

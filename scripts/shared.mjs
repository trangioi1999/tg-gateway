import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

export function wrangler(args, input, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      {
        stdio: [
          input !== undefined ? "pipe" : "inherit",
          capture ? "pipe" : "inherit",
          capture ? "pipe" : "inherit",
        ],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", () => {});
    }
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `Wrangler ${args[0]} failed (${code}). Check login and account permissions.`,
            ),
          ),
    );
  });
}
export async function prompt(label, secret = false) {
  if (!process.stdin.isTTY)
    throw new Error("Run setup in an interactive terminal.");
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const pending = rl.question(label);
    muted = secret;
    const answer = await pending;
    if (secret) process.stdout.write("\n");
    return answer.trim();
  } finally {
    rl.close();
  }
}
export async function credentialsFile(path) {
  const filename = resolve(path.replace(/^~(?=\/)/, homedir()));
  const data = JSON.parse(await readFile(filename, "utf8"));
  if (typeof data.refreshToken !== "string" || !data.refreshToken)
    throw new Error("Credentials JSON must contain refreshToken.");
  if (data.clientIdHash && (!data.clientId || !data.clientSecret)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.clientIdHash))
      throw new Error("Invalid clientIdHash.");
    const registration = JSON.parse(
      await readFile(
        join(dirname(filename), data.clientIdHash + ".json"),
        "utf8",
      ),
    );
    data.clientId = registration.clientId;
    data.clientSecret = registration.clientSecret;
  }
  if (Boolean(data.clientId) !== Boolean(data.clientSecret))
    throw new Error("SSO credentials require both clientId and clientSecret.");
  // Upload only auth fields; unrelated local account data is excluded.
  return Object.fromEntries(
    [
      "refreshToken",
      "accessToken",
      "expiresAt",
      "profileArn",
      "region",
      "clientId",
      "clientSecret",
    ]
      .filter((k) => typeof data[k] === "string")
      .map((k) => [k, data[k]]),
  );
}

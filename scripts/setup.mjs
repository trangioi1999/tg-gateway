import { randomBytes } from "node:crypto";
import { prompt, wrangler, credentialsFile, buildWeb } from "./shared.mjs";

try {
  console.log(
    "TG Gateway · First-time Cloudflare setup\nRun npm run login first. No secrets will be written to project files.",
  );
  await wrangler(["whoami"]);
  const path = await prompt("Path to your Kiro credentials JSON: ");
  const credentials = await credentialsFile(path);
  const admin = await prompt(
    "Choose ADMIN_PASSWORD (at least 16 characters; hidden): ",
    true,
  );
  const apiKey = await prompt(
    "Choose GATEWAY_API_KEY (at least 24 characters; hidden): ",
    true,
  );
  if (admin.length < 16 || apiKey.length < 24 || admin === apiKey)
    throw new Error(
      "Use distinct admin/API secrets with the required lengths.",
    );
  console.log("Building the web console...");
  await buildWeb();
  console.log("Deploying Worker and SQLite-backed Durable Object...");
  await wrangler(["deploy"]);
  const list = await wrangler(["secret", "list"], undefined, true);
  let existing;
  try {
    existing = JSON.parse(list);
  } catch {
    throw new Error(
      "Cannot verify existing secrets. Stop to avoid overwriting the encryption key.",
    );
  }
  if (existing.some((s) => s.name === "VAULT_KEY"))
    throw new Error(
      "Already initialized. Use npm run upload:credentials or wrangler secret put NAME. VAULT_KEY was preserved.",
    );
  const secrets = {
    ADMIN_PASSWORD: admin,
    GATEWAY_API_KEY: apiKey,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    VAULT_KEY: randomBytes(32).toString("hex"),
    KIRO_CREDENTIALS: JSON.stringify(credentials),
  };
  await wrangler(["secret", "bulk"], JSON.stringify(secrets));
  console.log(
    "\nSetup complete. Open the workers.dev URL printed above and sign in. Keep your chosen API key in your password manager.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

import { prompt, wrangler, credentialsFile } from "./shared.mjs";
try {
  const path =
    process.argv[2] ??
    (await prompt("Path to refreshed Kiro credentials JSON: "));
  const credentials = await credentialsFile(path);
  await wrangler(
    ["secret", "put", "KIRO_CREDENTIALS"],
    JSON.stringify(credentials),
  );
  console.log(
    "Uploaded. Gateway detects the new credential fingerprint automatically. No secret values were printed or saved.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

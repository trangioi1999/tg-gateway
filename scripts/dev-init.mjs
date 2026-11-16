import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const content = `# LOCAL ONLY. Never upload these sample passwords to production.\nADMIN_PASSWORD="local-dev-admin-change-me"\nGATEWAY_API_KEY="local-dev-api-key-change-me"\nSESSION_SECRET="${randomBytes(32).toString("hex")}"\nVAULT_KEY="${randomBytes(32).toString("hex")}"\n`;
try {
  await writeFile(".dev.vars", content, { flag: "wx", mode: 0o600 });
  console.log(
    "Created .dev.vars (local-only). Admin: local-dev-admin-change-me\nNo Kiro credentials configured. Dashboard works; live generation returns credentials_missing.",
  );
} catch (error) {
  if (error.code === "EEXIST")
    console.log(".dev.vars already exists; preserved.");
  else throw error;
}

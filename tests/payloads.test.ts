import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DELETE_ORPHAN_PAYLOADS } from "../src/db/schema.ts";

test("orphan payload cleanup keeps only payloads with a request row", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE requests (id TEXT PRIMARY KEY)");
  db.exec("CREATE TABLE payloads (id TEXT PRIMARY KEY, created INTEGER NOT NULL, request TEXT, response TEXT, truncated INTEGER NOT NULL DEFAULT 0)");
  db.exec("INSERT INTO requests VALUES ('a')");
  db.exec("INSERT INTO payloads VALUES ('a',1,'q','r',0),('gone',1,'q','r',0)");
  db.exec(DELETE_ORPHAN_PAYLOADS);
  assert.deepEqual(db.prepare("SELECT id FROM payloads").all().map((r) => r.id), ["a"]);
  db.exec("DELETE FROM requests");
  db.exec(DELETE_ORPHAN_PAYLOADS);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payloads").get()!.n, 0);
});

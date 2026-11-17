import { test } from "node:test";
import assert from "node:assert/strict";
import { createInFlightStore } from "../web/src/api/inFlight.ts";

test("instant requests cancel delayed visibility; release is idempotent", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createInFlightStore();
  let notifications = 0;
  store.subscribe(() => notifications++);
  const done = store.begin();
  assert.equal(store.getCount(), 1);
  t.mock.timers.tick(149);
  assert.equal(store.getSnapshot(), false);
  done(); done();
  t.mock.timers.tick(1000);
  assert.equal(store.getCount(), 0);
  assert.equal(store.getSnapshot(), false);
  assert.equal(notifications, 0);
});

test("overlapping requests stay visible until the last release; unsubscribe works", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createInFlightStore();
  const snapshots: boolean[] = [];
  const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));
  const a = store.begin();
  t.mock.timers.tick(100);
  const b = store.begin();
  t.mock.timers.tick(50);
  assert.equal(store.getSnapshot(), true);
  a();
  assert.equal(store.getSnapshot(), true);
  b();
  assert.deepEqual(snapshots, [true, false]);
  unsubscribe();
  const c = store.begin();
  t.mock.timers.tick(150);
  c();
  assert.deepEqual(snapshots, [true, false]);
});

test("a new burst gets its own delay after cancellation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createInFlightStore();
  const first = store.begin();
  t.mock.timers.tick(100);
  first();
  const second = store.begin();
  t.mock.timers.tick(149);
  assert.equal(store.getSnapshot(), false);
  t.mock.timers.tick(1);
  assert.equal(store.getSnapshot(), true);
  second();
  assert.equal(store.getSnapshot(), false);
});

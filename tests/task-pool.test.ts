import test from "node:test";
import assert from "node:assert/strict";
import { TaskPool } from "../src/core/task-pool.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("separate conversations run concurrently, with a bounded FIFO pool and disposal", async () => {
  const pool = new TaskPool<string>(2),
    release = deferred();
  const started: string[] = [],
    closed: string[] = [];
  const run = (id: string) =>
    pool.use(
      id,
      "account",
      async () => id,
      (value) => {
        closed.push(value);
      },
      async (value) => {
        started.push(value);
        await release.promise;
      },
    );
  const a = run("a"),
    b = run("b"),
    c = run("c");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(started, ["a", "b"]);
  release.resolve();
  await Promise.all([a, b, c]);
  assert.deepEqual(started, ["a", "b", "c"]);
  assert.deepEqual(closed.sort(), ["a", "b", "c"]);
});
test("nested work shares one resource, and failure never leaks capacity", async () => {
  const pool = new TaskPool<string>(1);
  let created = 0,
    disposed = 0;
  const create = async () => {
    created++;
    return "tab";
  };
  const dispose = () => {
    disposed++;
  };
  await assert.rejects(
    pool.use("a", "account", create, dispose, async (outer) => {
      await pool.use("a", "account", create, dispose, async (inner) =>
        assert.equal(inner, outer),
      );
      assert.equal(disposed, 0);
      throw new Error("Task failed");
    }),
    /Task failed/,
  );
  assert.equal(created, 1);
  assert.equal(disposed, 1);
  await assert.rejects(
    pool.use(
      "b",
      "account",
      async () => {
        throw new Error("Creation failed");
      },
      dispose,
      async () => {},
    ),
    /Creation failed/,
  );
  await pool.use("c", "account", create, dispose, async () => {});
  assert.equal(disposed, 2);
});
test("shutdown prevents queued work from creating pages", async () => {
  const pool = new TaskPool<string>(1),
    release = deferred();
  const a = pool.use(
    "a",
    "account",
    async () => "a",
    () => {},
    async () => release.promise,
  );
  const b = pool.use(
    "b",
    "account",
    async () => {
      assert.fail("Queued tab must not open after stop");
    },
    () => {},
    async () => {},
  );
  const rejection = assert.rejects(b, /đã dừng/);
  pool.stop();
  release.resolve();
  await a;
  await rejection;
});

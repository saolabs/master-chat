// Real Chromium with intercepted HTTPS fixtures; no live people or engine requests.
import { app, BrowserWindow, session } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PeopleSearch } from "../src/renderer/people-search.tsx";
import { emptyState, publicState, type Snapshot } from "../src/core/types.ts";
import { tmpdir } from "node:os";
import path from "node:path";
import { PeopleSearchBrowser } from "../electron/people-search-browser.ts";
import { PeopleSearchRunner } from "../electron/people-search-runner.ts";
import {
  peopleSearchInputSchema,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
app.setName("Master Chat people search fixture");
const directory = mkdtempSync(path.join(tmpdir(), "master-chat-people-smoke-"));
app.setPath("userData", directory);
app.on("will-quit", () => rmSync(directory, { recursive: true, force: true }));
app.whenReady().then(async () => {
  const s = session.fromPartition("people-search-smoke", { cache: false });
  let challenge = true;
  let requests = 0;
  s.protocol.handle("https", (request) => {
    requests++;
    const url = new URL(request.url);
    const direct =
      url.hostname === "www.facebook.com" &&
      url.pathname.startsWith("/search/people");
    const body = direct
      ? '<main><div role="listitem"><a href="https://www.facebook.com/fixture.an">Nguyễn An</a><p>Example Labs</p></div></main>'
      : url.hostname === "www.facebook.com"
        ? '<h1>Nguyễn An</h1><p>Nguyễn An works at Example Labs. This is a synthetic public account, linked to a personal website.</p><a href="https://example.com/an" rel="me">Nguyễn An website</a>'
        : url.hostname === "www.google.com"
          ? challenge
            ? "<h1>Verify you are human</h1><p>Fixture CAPTCHA: resolve manually.</p>"
            : '<div class="MjjYud"><a href="https://example.com/an"><h3>Nguyễn An</h3></a><p>A public professional profile at Example Labs.</p></div>'
          : "<h1>Nguyễn An</h1><p>Nguyễn An works at Example Labs. This fixture represents a public professional profile with no real personal data.</p>";
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Nguyễn An</title>${body}`,
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  });
  const browser = new PeopleSearchBrowser(async () => s);
  const state: { peopleSearches?: PeopleSearchJob[] } = {};
  const store = {
    read: () => structuredClone(state),
    mutate: async <T>(fn: (s: typeof state) => T) => fn(state),
  };
  const runner = new PeopleSearchRunner(store, browser, () => {});
  try {
    const input = peopleSearchInputSchema.parse({
      fullName: "Nguyễn An",
      organization: "Example Labs",
      engines: ["google"],
      platforms: [],
      depth: "quick",
    });
    await runner.start(input);
    await runner.idle();
    const id = state.peopleSearches![0].id;
    assert.equal(state.peopleSearches![0].status, "waiting");
    assert.equal(state.peopleSearches![0].cursor, 0);
    assert.equal(state.peopleSearches![0].evidence.length, 0);
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win.isVisible());
    // Replace only the fixture challenge content, keeping the same query URL.
    challenge = false;
    await win.webContents.reload();
    await new Promise<void>((resolve) =>
      win.webContents.once("did-finish-load", () => resolve()),
    );
    await runner.resume(id);
    await runner.idle();
    const job = state.peopleSearches![0];
    assert.equal(job.status, "completed");
    assert.equal(job.candidates.length, 1);
    assert.equal(job.candidates[0].confidence, "criteria_mentioned");
    assert.ok(job.evidence.find((e) => e.text)?.text?.includes("Example Labs"));
    assert.ok(requests >= 3);
    await runner.show(id, "https://example.com/an");
    assert.equal(win.webContents.getURL(), "https://example.com/an");
    await runner.start({
      ...input,
      platforms: ["facebook"],
      directPlatforms: ["facebook"],
    });
    await runner.idle();
    const directJob = state.peopleSearches![0];
    assert.equal(directJob.status, "completed");
    assert.match(directJob.tasks![0].url, /facebook.com\/search\/people/);
    assert.ok(
      directJob.evidence.some(
        (e) =>
          e.url === "https://www.facebook.com/fixture.an" &&
          e.metadata?.links.some((l) => l.kind === "rel_me"),
      ),
    );
    assert.ok(
      directJob.candidates.find((c) =>
        c.url.includes("facebook.com/fixture.an"),
      ),
    );
    if (process.env.MASTER_CHAT_PEOPLE_SCREENSHOT) {
      const snapshot: Snapshot = {
        data: { ...publicState(emptyState()), peopleSearches: [directJob] },
        tabs: [],
        paused: true,
        notice: "",
      };
      const markup = renderToStaticMarkup(
        React.createElement(PeopleSearch, {
          snapshot,
          busy: false,
          run: async () => snapshot,
        }),
      );
      const css = readFileSync(path.resolve("src/renderer/styles.css"), "utf8");
      const preview = new BrowserWindow({
        show: false,
        width: 1360,
        height: 1000,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      await preview.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(`<style>${css}</style><div class="app"><aside class="sidebar"><div class="brand">Master Chat</div><button class="nav active">⌕ Tìm người</button></aside><div class="workspace"><main>${markup}</main></div></div>`)}`,
      );
      assert.equal(
        await preview.webContents.executeJavaScript(
          "document.documentElement.scrollWidth <= innerWidth",
        ),
        true,
      );
      writeFileSync(
        process.env.MASTER_CHAT_PEOPLE_SCREENSHOT,
        (await preview.webContents.capturePage()).toPNG(),
      );
      preview.destroy();
    }
    console.log(
      "PASS: Chromium CAPTCHA recovery, direct Facebook People discovery, declared links and source evidence",
    );
    runner.shutdown();
    rmSync(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    runner.shutdown();
    rmSync(directory, { recursive: true, force: true });
    app.exit(1);
  }
});

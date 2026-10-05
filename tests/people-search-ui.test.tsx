import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { PeopleSearch } from "../src/renderer/people-search.tsx";
import { emptyState, publicState, type Snapshot } from "../src/core/types.ts";
import {
  peopleSearchInputSchema,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
test("search UI exposes evidence limits and keeps CAPTCHA recovery/cancel controls usable", () => {
  const job: PeopleSearchJob = {
    id: "fixture",
    input: peopleSearchInputSchema.parse({
      fullName: "An",
      engines: ["google"],
      platforms: [],
      depth: "quick",
    }),
    queries: ['"An"'],
    status: "waiting",
    phase: "search",
    cursor: 0,
    sourceCursor: 0,
    sourceUrls: [],
    evidence: [],
    candidates: [],
    errors: [],
    message: "CAPTCHA",
    createdAt: 1,
    updatedAt: 1,
  };
  const snapshot: Snapshot = {
    data: { ...publicState(emptyState()), peopleSearches: [job] },
    tabs: [],
    paused: true,
    notice: "",
  };
  const dom = new JSDOM(
    renderToStaticMarkup(
      <PeopleSearch
        snapshot={snapshot}
        busy={false}
        run={async () => snapshot}
      />,
    ),
  );
  try {
    const buttons = [...dom.window.document.querySelectorAll("button")];
    for (const text of [
      "Tiếp tục",
      "Bỏ qua trang này",
      "Dừng tìm kiếm",
      "Mở trình duyệt tìm kiếm",
    ])
      assert.equal(
        buttons.find((b) => b.textContent === text)!.disabled,
        false,
      );
    assert.equal(
      buttons.find((b) => b.textContent === "Bắt đầu tìm người")!.disabled,
      true,
    );
    assert.match(
      dom.window.document.body.textContent!,
      /chưa xác minh danh tính/,
    );
  } finally {
    dom.window.close();
  }
});

test("advanced criteria, direct sources and exhaustive scope are present with collapsed advanced controls", () => {
  const snapshot: Snapshot = {
    data: publicState(emptyState()),
    tabs: [],
    paused: true,
    notice: "",
  };
  const dom = new JSDOM(
    renderToStaticMarkup(
      <PeopleSearch
        snapshot={snapshot}
        busy={false}
        run={async () => snapshot}
      />,
    ),
  );
  try {
    for (const name of [
      "fullName",
      "familyName",
      "givenName",
      "email",
      "phone",
      "phoneCountry",
      "username",
      "organization",
      "profileUrl",
      "language",
    ])
      assert.ok(dom.window.document.querySelector(`[name="${name}"]`), name);
    const advanced = [...dom.window.document.querySelectorAll("details")].find(
      (d) =>
        d.querySelector("summary")?.textContent?.includes("Thông tin nâng cao"),
    )!;
    assert.equal(advanced.open, false);
    assert.equal(
      dom.window.document
        .querySelector('option[value="exhaustive"]')
        ?.textContent?.includes("500 nguồn"),
      true,
    );
    assert.equal(
      [...dom.window.document.querySelectorAll("label")].filter(
        (l) => l.textContent === "Tìm trực tiếp",
      ).length,
      6,
    );
    for (const label of ["+ Tỉnh/thành", "+ Trường học", "+ Khác"])
      assert.ok(dom.window.document.body.textContent?.includes(label));
  } finally {
    dom.window.close();
  }
});

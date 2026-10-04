// Isolated Chromium fixture: no live Facebook requests, user credentials or messages.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { Browsers } from "../electron/browser.ts";
import {
  emptyState,
  type Account,
  type State,
  type Conversation,
} from "../src/core/types.ts";
import type { Vault } from "../electron/vault.ts";
app.setName("Master Chat fixture test");
app.whenReady().then(async () => {
  const state = emptyState();
  const account: Account = {
    id: "fixture-account",
    name: "Fixture",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
  };
  state.accounts.push(account);
  const vault = {
    read: () => structuredClone(state),
    mutate: async (fn: (s: State) => unknown) => fn(state),
  } as unknown as Vault;
  const host = new BrowserWindow({ show: false, width: 1100, height: 800 });
  let pauses = 0;
  const b = new Browsers(
    host,
    vault,
    () => {},
    () => {
      pauses++;
    },
  );
  try {
    const session = await (
      b as unknown as { accountSession(a: Account): Promise<Electron.Session> }
    ).accountSession(account);
    await session.cookies.set({
      url: "https://www.facebook.com",
      name: "c_user",
      value: "fixture-user",
      domain: ".facebook.com",
      secure: true,
    });
    session.protocol.handle(
      "https",
      () =>
        new Response(
          `<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif} [role=button],button,[contenteditable]{display:block;min-height:30px} [contenteditable]{border:1px solid gray} </style><div role="grid" aria-label="Đoạn chat"><div role="row"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Fixture Recipient</span><span>Tin nhắn chưa đọc</span></a></div></div><section id="timeline"><div role="article"><time datetime="${new Date().toISOString()}"></time><div role="button" aria-label="Nhập, Tin nhắn do Fixture Recipient gửi lúc 10:19: Test incoming"></div></div></section><div contenteditable="true" role="textbox" aria-label="Viết cho Fixture Recipient"></div><button aria-label="Gửi lượt thích" id="like"></button><button aria-label="Nhấn Enter để gửi" id="send"></button><script>window.inputs=0;window.sends=0;window.likes=0;const composer=document.querySelector('[contenteditable]');composer.addEventListener('input',()=>window.inputs++);document.querySelector('#like').onclick=()=>window.likes++;document.querySelector('#send').onclick=()=>{window.sends++;const article=document.createElement('div');article.setAttribute('role','article');const time=document.createElement('time');time.setAttribute('datetime',new Date().toISOString());article.append(time);const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Nhập, Tin nhắn do Bạn gửi lúc 10:20: '+composer.textContent);article.append(node);document.querySelector('#timeline').append(article);composer.textContent='';};</script>`,
          { headers: { "content-type": "text/html;charset=utf-8" } },
        ),
    );
    const scan = await b.scanInbox(account.id);
    assert.equal(scan.threads.length, 1);
    assert.equal(scan.threads[0].name, "Fixture Recipient");
    assert.equal(scan.coverage, "visible");
    const c: Conversation = {
      id: "c",
      accountId: account.id,
      platformId: "123",
      name: "Fixture Recipient",
      url: "https://www.facebook.com/messages/t/123/",
      messages: [],
      initialized: false,
      autoReply: false,
      pendingIds: [],
      summary: { text: "", coveredIds: [], revision: 0 },
    };
    const raw = await b.readConversation(c);
    assert.equal(raw.length, 1);
    assert.equal(raw[0].text, "Test incoming");
    assert.equal(raw[0].identity, "fingerprint");
    assert.equal(raw[0].direction, "incoming");
    c.messages = raw.map((m) => ({ ...m, baseline: true }));
    c.initialized = true;
    await b.send(c, undefined, "Chromium fixture reply", raw[0].id, () => true);
    const worker = (
      b as unknown as { workers: Map<string, Electron.WebContentsView> }
    ).workers.get(account.id)!.webContents;
    const result = await worker.executeJavaScript(
      '({inputs:window.inputs,sends:window.sends,likes:window.likes,text:document.querySelector("[contenteditable]").textContent})',
    );
    assert.equal(result.inputs, 1);
    assert.equal(result.sends, 1);
    assert.equal(result.likes, 0);
    assert.equal(result.text, "");
    assert.equal(pauses, 0);
    await worker.executeJavaScript(
      'history.replaceState(null,"",location.pathname+"#fixture")',
    );
    const echoed = await b.readConversation(c);
    assert.equal(echoed.at(-1)?.direction, "outgoing");
    assert.equal(echoed.at(-1)?.text, "Chromium fixture reply");
    await worker.executeJavaScript(
      'document.querySelector("[contenteditable]").textContent="Human draft"',
    );
    await assert.rejects(
      b.send(c, undefined, "Should not send", echoed.at(-1)!.id, () => true),
      /Người dùng/,
    );
    await worker.executeJavaScript(
      'document.querySelector("[contenteditable]").textContent="";document.querySelector("a[aria-current=page]").href="/messages/t/999/"',
    );
    await assert.rejects(
      b.send(c, undefined, "Should not send", echoed.at(-1)!.id, () => true),
      /Sai hội thoại/,
    );
    await worker.executeJavaScript(
      `document.querySelector('a[aria-current=page]').href='/messages/t/123/';document.querySelector('[contenteditable]').addEventListener('input',()=>{const article=document.createElement('div');article.setAttribute('role','article');const time=document.createElement('time');time.setAttribute('datetime',new Date().toISOString());article.append(time);const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Nhập, Tin nhắn do Fixture Recipient gửi lúc 10:21: Race incoming');article.append(node);document.querySelector('#timeline').append(article);},{once:true});`,
    );
    await assert.rejects(
      b.send(c, undefined, "Race reply", echoed.at(-1)!.id, () => true),
      /Có tin mới/,
    );
    const race = await worker.executeJavaScript(
      '({sends:window.sends,text:document.querySelector("[contenteditable]").textContent})',
    );
    assert.equal(race.sends, 1);
    assert.equal(race.text, "Race reply");
    await worker.executeJavaScript(
      `document.querySelector('[contenteditable]').textContent='';const hidden=document.createElement('div');hidden.style.display='none';hidden.innerHTML='<div role="dialog"></div><input type="password">';document.body.append(hidden);`,
    );
    await b.readConversation(c);
    await worker.executeJavaScript(
      `const dialog=document.createElement('div');dialog.id='pin-fixture';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Khôi phục lịch sử chat');dialog.textContent='Fixture PIN dialog';document.body.append(dialog);`,
    );
    await assert.rejects(b.readConversation(c), /Khôi phục lịch sử chat/);
    const verificationTab = b
      .list()
      .find((tab) => tab.status === "Cần xử lý hộp thoại trong cửa sổ này")!;
    assert.ok(verificationTab);
    assert.ok(pauses > 0);
    await assert.rejects(b.readConversation(c), /đóng cửa sổ/);
    await assert.rejects(
      b.send(c, undefined, "Blocked", raw[0].id, () => true),
      /xác minh/,
    );
    await worker.executeJavaScript(
      `document.querySelector('#pin-fixture').remove()`,
    );
    const verificationWindow = BrowserWindow.getAllWindows().find(
      (win) => win !== host,
    )!;
    const closed = new Promise<void>((resolve) =>
      verificationWindow.once("closed", () => resolve()),
    );
    b.close(verificationTab.id);
    await closed;
    assert.equal(worker.isDestroyed(), false);
    await b.readConversation(c);
    await session.cookies.set({
      url: "https://www.facebook.com",
      name: "c_user",
      value: "different-fixture-user",
      domain: ".facebook.com",
      secure: true,
    });
    await assert.rejects(b.readConversation(c), /Phiên Facebook không khớp/);
    console.log(
      "Chromium fixture passed: inbox discovery, native read, CDP input event, send/echo, human draft, DOM drift and account identity guards.",
    );
    b.shutdown();
    host.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    b.shutdown();
    host.destroy();
    app.exit(1);
  }
});

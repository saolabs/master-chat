// Isolated Chromium fixture: no live Facebook requests, user credentials or messages.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Browsers } from "../electron/browser.ts";
import {
  emptyState,
  type Account,
  type State,
  type Conversation,
  type DOMProfile,
} from "../src/core/types.ts";
import type { Vault } from "../electron/vault.ts";
import { SendNotAttemptedError } from "../src/core/send-status.ts";
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
    const fixtureTimestamp = new Date().toISOString();
    let serverText = "Test incoming";
    let profileFixture = false;
    let pinOnLoad = false;
    let rateLimitedPage = false;
    let pageRequests = 0;
    session.protocol.handle("https", (request) => {
      pageRequests++;
      if (new URL(request.url).hostname === "scontent.fbcdn.net")
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      if (rateLimitedPage)
        return new Response(
          '<!doctype html><meta charset="utf-8"><h2>Bạn tạm thời bị chặn</h2><p>Có vẻ như bạn đang dùng nhầm tính năng này do sử dụng quá nhanh.</p><div contenteditable="true" role="textbox" aria-label="Viết cho Fixture Recipient"></div>',
          { headers: { "content-type": "text/html;charset=utf-8" } },
        );
      if (pinOnLoad)
        return new Response(
          `<!doctype html><meta charset="utf-8"><div id="ready" hidden><div role="grid" aria-label="Đoạn chat"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Fixture Recipient</span></a></div><div role="article"><time datetime="${fixtureTimestamp}"></time><div role="button" aria-label="Tin nhắn do Fixture Recipient gửi lúc 10:19: Restored on startup"></div></div><div contenteditable="true" role="textbox" aria-label="Viết cho Fixture Recipient"></div></div><main id="restore"><h1>Nhập mã PIN</h1><p>Đồng bộ lịch sử đoạn chat</p><input type="password" maxlength="6"><button disabled>Tiếp tục</button></main><script>window.pinSubmits=0;const modal=document.querySelector('#restore');modal.querySelector('input').addEventListener('input',(event)=>{if(event.isTrusted)setTimeout(()=>modal.querySelector('button').disabled=false,100);});modal.querySelector('button').onclick=()=>{window.pinSubmits++;if(modal.querySelector('input').value==='012345'){modal.remove();document.querySelector('#ready').hidden=false;}};</script>`,
          { headers: { "content-type": "text/html;charset=utf-8" } },
        );
      if (profileFixture)
        return new Response(
          `<!doctype html><meta charset="utf-8"><section data-thread="123"><div class="msg" data-id="profile-in" data-dir="in" data-time="${fixtureTimestamp}"><span class="text">Profile incoming</span></div></section><div contenteditable="true" role="textbox"></div><button id="send">Send</button><script>window.sends=0;document.querySelector('#send').onclick=()=>{window.sends++;const composer=document.querySelector('[contenteditable]');const msg=document.createElement('div');msg.className='msg';msg.dataset.id='profile-out';msg.dataset.dir='out';msg.dataset.time=new Date().toISOString();const text=document.createElement('span');text.className='text';text.textContent=composer.textContent;msg.append(text);document.querySelector('section').append(msg);composer.textContent='';};</script>`,
          { headers: { "content-type": "text/html;charset=utf-8" } },
        );
      return new Response(
        `<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif} [role=button],button,[contenteditable]{display:block;min-height:30px} [contenteditable]{border:1px solid gray} </style><div role="grid" aria-label="Đoạn chat"><div role="row"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Fixture Recipient</span><span>Tin nhắn chưa đọc</span></a></div></div><section id="timeline"><div role="article"><time datetime="${fixtureTimestamp}"></time><div role="button" aria-label="Nhập, Tin nhắn do Fixture Recipient gửi lúc 10:19: ${serverText}"></div></div></section><div contenteditable="true" role="textbox" aria-label="Viết cho Fixture Recipient"></div><button aria-label="Gửi lượt thích" id="like"></button><button aria-label="Nhấn Enter để gửi" id="send"></button><script>window.inputs=0;window.sends=0;window.likes=0;const composer=document.querySelector('[contenteditable]');composer.addEventListener('input',()=>window.inputs++);document.querySelector('#like').onclick=()=>window.likes++;document.querySelector('#send').onclick=()=>{window.sends++;const article=document.createElement('div');article.setAttribute('role','article');const time=document.createElement('time');time.setAttribute('datetime',new Date().toISOString());article.append(time);const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Nhập, Tin nhắn do Bạn gửi lúc 10:20: '+composer.textContent);article.append(node);document.querySelector('#timeline').append(article);composer.textContent='';};</script>`.replaceAll(
          "/messages/t/123/",
          new URL(request.url).pathname.includes("/456/")
            ? "/messages/t/456/"
            : "/messages/t/123/",
        ),
        { headers: { "content-type": "text/html;charset=utf-8" } },
      );
    });
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
    let releaseFixture!: () => void, fixtureStarted!: () => void;
    const fixtureGate = new Promise<void>((resolve) => {
      releaseFixture = resolve;
    });
    const fixtureReady = new Promise<void>((resolve) => {
      fixtureStarted = resolve;
    });
    const heldFixture = b.withConversationTask(c, async () => {
      fixtureStarted();
      await fixtureGate;
    });
    await fixtureReady;
    const raw = await b.readConversation(c);
    assert.equal(raw.length, 1);
    assert.equal(raw[0].text, "Test incoming");
    assert.equal(raw[0].identity, "fingerprint");
    assert.equal(raw[0].direction, "incoming");
    c.messages = raw.map((m) => ({ ...m, baseline: true }));
    c.initialized = true;
    const worker = (
      b as unknown as { workers: Map<string, Electron.WebContentsView> }
    ).workers.get(c.id)!.webContents;
    // Closing a page with a stalled executeJavaScript must release the PIN
    // queue; a different page in the account can still restore afterwards.
    const abandoned = new EventEmitter() as EventEmitter & {
      id: number;
      isDestroyed(): boolean;
      getURL(): string;
      executeJavaScript(): Promise<never>;
    };
    abandoned.id = -1;
    let destroyed = false;
    abandoned.isDestroyed = () => destroyed;
    abandoned.getURL = () => "https://www.facebook.com/messages/";
    let entered!: () => void;
    const enteredProbe = new Promise<void>((resolve) => {
      entered = resolve;
    });
    abandoned.executeJavaScript = () => {
      entered();
      return new Promise<never>(() => {});
    };
    const restoreAbandoned = (
      b as unknown as {
        restorePin(wc: Electron.WebContents, a: Account): Promise<string>;
      }
    ).restorePin.bind(b);
    const stalled = restoreAbandoned(
      abandoned as unknown as Electron.WebContents,
      account,
    );
    await enteredProbe;
    destroyed = true;
    abandoned.emit("destroyed");
    assert.equal(await stalled, "blocked");
    assert.equal(abandoned.listenerCount("destroyed"), 0);
    assert.equal(await restoreAbandoned(worker, account), "absent");
    assert.equal(state.accounts[0].pinAutoFillBlocked, undefined);
    // A different conversation can be visited between Engine.observe and its queued send.
    await worker.loadURL("https://www.facebook.com/messages/t/999/");
    await assert.rejects(
      b.send(c, undefined, "Canceled", raw[0].id, () => false),
      (error) => error instanceof SendNotAttemptedError,
    );
    assert.ok(worker.getURL().includes("/999/"));
    assert.equal(
      await worker.executeJavaScript("window.inputs + window.sends"),
      0,
    );
    await b.send(c, undefined, "Chromium fixture reply", raw[0].id, () => true);
    assert.ok(worker.getURL().includes("/123/"));
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
      (error) =>
        error instanceof SendNotAttemptedError &&
        /Người dùng/.test(error.message),
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
      (error) =>
        !(error instanceof SendNotAttemptedError) &&
        error instanceof Error &&
        /Có tin mới/.test(error.message),
    );
    const race = await worker.executeJavaScript(
      '({sends:window.sends,text:document.querySelector("[contenteditable]").textContent})',
    );
    assert.equal(race.sends, 1);
    assert.equal(race.text, "Race reply");
    const uncertainTab = b
      .list()
      .find((tab) => tab.status === "Cần kiểm tra kết quả gửi");
    assert.ok(uncertainTab);
    const uncertainWindow = BrowserWindow.getAllWindows().find(
      (win) => win !== host,
    )!;
    const uncertainClosed = new Promise<void>((resolve) =>
      uncertainWindow.once("closed", resolve),
    );
    b.close(uncertainTab.id);
    await uncertainClosed;
    // Human-approved text is not tied to the AI draft's last-message context.
    await worker.executeJavaScript(
      `document.querySelector('[contenteditable]').textContent=''`,
    );
    await b.send(
      c,
      undefined,
      "Explicit human reply",
      "outdated-context",
      () => true,
      false,
    );
    const manualEcho = await b.readConversation(c);
    assert.equal(manualEcho.at(-1)?.direction, "outgoing");
    assert.equal(manualEcho.at(-1)?.text, "Explicit human reply");
    await worker.executeJavaScript(
      `document.querySelector('a[aria-current=page]').href='/messages/t/999/'`,
    );
    await assert.rejects(
      b.send(c, undefined, "Wrong recipient", null, () => true, false),
      /Sai hội thoại/,
    );
    await worker.executeJavaScript(
      `document.querySelector('a[aria-current=page]').href='/messages/t/123/';document.querySelector('[contenteditable]').textContent='Human browser draft'`,
    );
    await assert.rejects(
      b.send(c, undefined, "Do not overwrite", null, () => true, false),
      /Người dùng/,
    );
    await worker.executeJavaScript(
      `document.querySelector('[contenteditable]').textContent='';const hidden=document.createElement('div');hidden.style.display='none';hidden.innerHTML='<div role="dialog"></div><input type="password">';document.body.append(hidden);`,
    );
    await b.readConversation(c);
    const beforeTransient = pauses;
    await worker.executeJavaScript(
      `(()=>{const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='Loading Messenger';document.body.append(dialog);setTimeout(()=>dialog.remove(),500);})()`,
    );
    await b.readConversation(c);
    assert.equal(pauses, beforeTransient);
    await worker.executeJavaScript(
      `(()=>{const dialog=document.createElement('div');dialog.id='persistent-loading';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Thông báo');dialog.innerHTML='<h2>Đang tải tin nhắn...</h2>';document.body.append(dialog);})()`,
    );
    await assert.rejects(b.readConversation(c), /hộp thoại/);
    assert.equal(pauses, beforeTransient);
    assert.equal(
      b.list().some((tab) => tab.title.endsWith("Messenger cần kiểm tra")),
      false,
    );
    await worker.executeJavaScript(
      `document.querySelector('#persistent-loading').remove()`,
    );
    await b.readConversation(c);
    assert.equal(
      b.list().some((tab) => tab.title.endsWith("Messenger cần kiểm tra")),
      false,
    );
    await worker.executeJavaScript(
      `const dialog=document.createElement('div');dialog.id='pin-fixture';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Khôi phục lịch sử chat');dialog.textContent='Fixture PIN dialog';document.body.append(dialog);`,
    );
    await assert.rejects(b.readConversation(c), /Khôi phục lịch sử chat/);
    const verificationTab = b
      .list()
      .find((tab) => tab.title.endsWith("Messenger cần kiểm tra"))!;
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
    // Real Chromium recovery UI: fill six cells once, remove the modal on accepted PIN.
    state.accounts[0].recoveryPin = "012345";
    state.accounts[0].autoRestorePin = true;
    await worker.executeJavaScript(
      `(()=>{window.pinEvents=0;window.pinTimes=[];const modal=document.createElement('div');modal.id='restore-pin';modal.setAttribute('role','dialog');modal.innerHTML='<h2>Nhập mã PIN để khôi phục đoạn chat của bạn</h2>'+Array.from({length:6},()=>'<input type="password" maxlength="1">').join('');modal.addEventListener('input',()=>{window.pinEvents++;window.pinTimes.push(performance.now());const inputs=Array.from(modal.querySelectorAll('input'));const value=inputs.map(i=>i.value).join('');if(value==='012345'){modal.remove();return;}inputs.forEach(input=>input.disabled=true);setTimeout(()=>inputs.forEach(input=>{const updated=input.cloneNode();updated.value=input.value;updated.disabled=false;input.replaceWith(updated);}),350);});document.body.append(modal);})()`,
    );
    await b.readConversation(c);
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 6);
    const pinTimes = (await worker.executeJavaScript(
      "window.pinTimes",
    )) as number[];
    for (let i = 1; i < pinTimes.length; i++)
      assert.ok(
        pinTimes[i] - pinTimes[i - 1] >= 350,
        "next digit must wait for the replaced field to become ready",
      );
    assert.equal(state.accounts[0].pinAutoFillBlocked, false);
    assert.equal(
      b.list().some((tab) => tab.title.endsWith("Messenger cần kiểm tra")),
      false,
    );
    // A block appearing between split digits ends the attempt before any further input.
    await worker.executeJavaScript(
      `(()=>{window.pinEvents=0;const modal=document.createElement('div');modal.id='restore-pin';modal.setAttribute('role','dialog');modal.innerHTML='<h2>Nhập mã PIN để khôi phục đoạn chat của bạn</h2>'+ '<input type="password" maxlength="1">'.repeat(6);modal.addEventListener('input',()=>{window.pinEvents++;setTimeout(()=>{const block=document.createElement('h1');block.id='mid-pin-block';block.textContent='Bạn tạm thời bị chặn';document.body.append(block);},100);});document.body.append(modal);})()`,
    );
    assert.equal(await restoreAbandoned(worker, account), "blocked");
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    assert.equal(state.accounts[0].pinAutoFillBlocked, true);
    assert.equal(state.accounts[0].pinRestorePending, false);
    assert.equal(await restoreAbandoned(worker, account), "blocked");
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    await worker.executeJavaScript(
      `document.querySelector('#restore-pin').remove();document.querySelector('#mid-pin-block').remove()`,
    );
    state.accounts[0].pinAutoFillBlocked = false;
    state.accounts[0].pinRestorePending = false;
    // A widget that clears the entered PIN without a confirmed result must not
    // release the retry guard just because its input is empty again.
    await worker.executeJavaScript(
      `(()=>{window.pinEvents=0;const modal=document.createElement('div');modal.id='restore-pin';modal.setAttribute('role','dialog');modal.innerHTML='<h2>Nhập mã PIN để khôi phục đoạn chat của bạn</h2><input type="password" maxlength="6">';modal.addEventListener('input',(event)=>{if(event.isTrusted){window.pinEvents++;modal.querySelector('input').value='';}});document.body.append(modal);})()`,
    );
    const clearedRestore = (
      b as unknown as {
        restorePin(wc: Electron.WebContents, a: Account): Promise<string>;
      }
    ).restorePin.bind(b);
    assert.equal(await clearedRestore(worker, account), "blocked");
    assert.equal(
      await worker.executeJavaScript("window.pinEvents"),
      1,
      "cleared PIN was inserted only once in the first attempt",
    );
    assert.equal(state.accounts[0].pinAutoFillBlocked, true);
    assert.equal(state.accounts[0].pinRestorePending, false);
    const readyMonitor = (
      b as unknown as { monitors: Map<string, Electron.WebContentsView> }
    ).monitors.get(account.id)!;
    assert.equal(
      await restoreAbandoned(readyMonitor.webContents, account),
      "absent",
    );
    assert.equal(state.accounts[0].pinAutoFillBlocked, true);
    assert.equal(await clearedRestore(worker, account), "blocked");
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    await worker.executeJavaScript(
      `document.querySelector('#restore-pin').remove()`,
    );
    state.accounts[0].pinAutoFillBlocked = false;
    state.accounts[0].pinRestorePending = false;
    // A rejected PIN is durably blocked, and concurrent calls share the same single attempt.
    await worker.executeJavaScript(
      `(()=>{window.pinEvents=0;const modal=document.createElement('div');modal.id='restore-pin';modal.setAttribute('role','dialog');modal.innerHTML='<h2>Nhập mã PIN để khôi phục đoạn chat của bạn</h2><input type="password" maxlength="6"><p></p>';modal.addEventListener('input',()=>{window.pinEvents++;modal.querySelector('p').textContent='Mã PIN không chính xác';});document.body.append(modal);})()`,
    );
    const restore = (
      b as unknown as {
        restorePin(wc: Electron.WebContents, a: Account): Promise<string>;
      }
    ).restorePin.bind(b);
    assert.deepEqual(
      await Promise.all([restore(worker, account), restore(worker, account)]),
      ["blocked", "blocked"],
    );
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    assert.equal(state.accounts[0].pinAutoFillBlocked, true);
    await worker.executeJavaScript(
      `document.querySelector('#restore-pin input').value='';document.querySelector('#restore-pin p').textContent='';`,
    );
    assert.equal(await restore(worker, account), "blocked");
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    const duplicate = new Browsers(
      host,
      vault,
      () => {},
      () => {},
    );
    const retryAfterRestart = (
      duplicate as unknown as {
        restorePin(wc: Electron.WebContents, a: Account): Promise<string>;
      }
    ).restorePin.bind(duplicate);
    assert.equal(await retryAfterRestart(worker, account), "blocked");
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    // Explicit opt-out does not fill even when a PIN has been stored.
    state.accounts[0].pinAutoFillBlocked = false;
    state.accounts[0].autoRestorePin = false;
    assert.equal(await restore(worker, account), "blocked");
    assert.equal(await worker.executeJavaScript("window.pinEvents"), 1);
    await worker.executeJavaScript(
      `document.querySelector('#restore-pin').remove()`,
    );
    // Saving a corrected PIN also resolves an already exposed worker and keeps its session alive.
    await worker.executeJavaScript(
      `(()=>{const modal=document.createElement('div');modal.id='restore-pin';modal.setAttribute('role','dialog');modal.innerHTML='<h2>Nhập mã PIN để khôi phục đoạn chat của bạn</h2><input type="password" maxlength="6">';modal.addEventListener('input',()=>{if(modal.querySelector('input').value==='012345')modal.remove();});document.body.append(modal);})()`,
    );
    await assert.rejects(b.readConversation(c), /Hoàn tất/);
    const pinWindow = BrowserWindow.getAllWindows().find(
      (win) => win !== host,
    )!;
    const pinClosed = new Promise<void>((resolve) =>
      pinWindow.once("closed", () => resolve()),
    );
    state.accounts[0].autoRestorePin = true;
    state.accounts[0].pinAutoFillBlocked = false;
    assert.equal(await restore(worker, account), "restored");
    await pinClosed;
    assert.equal(worker.isDestroyed(), false);
    await b.readConversation(c);
    // Live view remains pinned to the selected thread while the send/history worker visits another.
    const liveInitial = await b.readLiveConversation(c);
    assert.equal(liveInitial[0].text, "Test incoming");
    const liveView = (
      b as unknown as { liveViews: Map<string, Electron.WebContentsView> }
    ).liveViews.get(account.id)!.webContents;
    await liveView.executeJavaScript(
      `(()=>{const article=document.createElement('div');article.setAttribute('role','article');article.innerHTML='<time datetime="'+new Date().toISOString()+'"></time><div role="button" aria-label="Nhập, Tin nhắn do Fixture Recipient gửi lúc 10:22: Live fixture incoming"></div>';document.querySelector('#timeline').append(article);})()`,
    );
    await worker.executeJavaScript(
      `history.replaceState(null,'','/messages/t/999/')`,
    );
    const liveNew = await b.readLiveConversation(c);
    assert.equal(liveNew.at(-1)?.text, "Live fixture incoming");
    assert.ok(worker.getURL().includes("/999/"));
    assert.ok(liveView.getURL().includes("/123/"));
    await worker.executeJavaScript(
      `history.replaceState(null,'','/messages/t/123/')`,
    );
    // Media is read through the same isolated account session; page blobs stay in their owning WebContents.
    await worker.executeJavaScript(
      `(()=>{const timeline=document.querySelector('#timeline');const photo=document.createElement('div');photo.setAttribute('role','article');photo.setAttribute('data-message-id','fixture-photo');photo.innerHTML='<time datetime="'+new Date().toISOString()+'"></time><div role="button" aria-label="Tin nhắn do Fixture Recipient gửi lúc 10:23: Ảnh"><img alt="Ảnh được gửi" width="180" src="https://scontent.fbcdn.net/fixture.png"></div>';timeline.append(photo);const voice=document.createElement('div');voice.setAttribute('role','article');voice.setAttribute('data-message-id','fixture-voice');voice.innerHTML='<time datetime="'+new Date().toISOString()+'"></time><div role="button" aria-label="Tin nhắn do Fixture Recipient gửi lúc 10:24: Tin nhắn thoại"></div><audio></audio>';voice.querySelector('audio').src=URL.createObjectURL(new Blob([new Uint8Array([4,5,6])],{type:'audio/mp4'}));timeline.append(voice);})()`,
    );
    const mediaRead = await b.readConversation(c);
    const photo = mediaRead.find((m) => m.id === "fixture-photo")!,
      voice = mediaRead.find((m) => m.id === "fixture-voice")!;
    assert.equal(
      (await b.readAttachment(c, photo.id, photo.attachments![0].id)).data,
      "AQID",
    );
    const voicePayload = await b.readAttachment(
      c,
      voice.id,
      voice.attachments![0].id,
    );
    assert.equal(voicePayload.data, "BAUG");
    assert.equal(voicePayload.mimeType, "audio/mp4");
    // A detached player starts only from trusted Chromium input, then exposes
    // its blob without placing an audio element in the message DOM.
    await worker.executeJavaScript(
      `(()=>{window.voiceClicks=0;HTMLMediaElement.prototype.play=function(){return Promise.resolve()};const cachedPlay=HTMLMediaElement.prototype.play;window.fixtureAudio=window.Audio;const voice=document.createElement('div');voice.setAttribute('role','article');voice.setAttribute('data-message-id','fixture-detached-voice');voice.innerHTML='<time datetime="'+new Date().toISOString()+'"></time><div role="button" aria-label="Tin nhắn do Fixture Recipient gửi lúc 10:25: Tin nhắn thoại"></div><button>Phát</button>';voice.querySelector('button').onclick=(event)=>{if(!event.isTrusted)return;window.voiceClicks++;const audio=new Audio(URL.createObjectURL(new Blob([new Uint8Array([7,8,9])],{type:'audio/mp4'})));void (window.useCachedPlay ? cachedPlay.call(audio) : audio.play());};document.querySelector('#timeline').append(voice);})()`,
    );
    const detachedVoice = (await b.readConversation(c)).find(
      (m) => m.id === "fixture-detached-voice",
    )!;
    assert.equal(
      (
        await b.readAttachment(
          c,
          detachedVoice.id,
          detachedVoice.attachments![0].id,
        )
      ).data,
      "BwgJ",
    );
    assert.equal(await worker.executeJavaScript("window.voiceClicks"), 1);
    assert.equal(
      await worker.executeJavaScript("window.Audio === window.fixtureAudio"),
      true,
    );
    await worker.executeJavaScript("window.useCachedPlay = true");
    assert.equal(
      (
        await b.readAttachment(
          c,
          detachedVoice.id,
          detachedVoice.attachments![0].id,
        )
      ).data,
      "BwgJ",
    );
    assert.equal(await worker.executeJavaScript("window.voiceClicks"), 2);
    assert.equal(
      await worker.executeJavaScript("window.Audio === window.fixtureAudio"),
      true,
    );
    // Current Messenger can omit aria-current. A rendered recipient region +
    // composer + unique inbox URL still binds the thread; stale regions do not.
    const noMarker = `(()=>{document.querySelector('a[aria-current]').removeAttribute('aria-current');const region=document.createElement('section');region.setAttribute('aria-label','Cuộc trò chuyện với Fixture Recipient');for(const node of [...document.querySelectorAll('#timeline,[contenteditable],button')])region.append(node);document.body.append(region);})()`;
    await worker.executeJavaScript(noMarker);
    await liveView.executeJavaScript(noMarker);
    const virtualizedInbox = `(()=>{const grid=document.querySelector('[role="grid"]');grid.style.cssText='height:120px;overflow-y:auto';grid.innerHTML='<div style="height:900px"><a href="/messages/t/999/"><span dir="auto">Another thread</span></a></div>';grid.addEventListener('scroll',()=>{if(grid.scrollTop>100)grid.innerHTML='<div style="height:900px"><a href="/messages/t/123/"><span dir="auto">Fixture Recipient</span></a></div>';});})()`;
    await worker.executeJavaScript(virtualizedInbox);
    await liveView.executeJavaScript(virtualizedInbox);
    const noMarkerRead = await b.readConversation(c);
    assert.ok(
      await worker.executeJavaScript(
        `document.querySelector('[role="grid"]').scrollTop > 100`,
      ),
    );
    await b.send(
      c,
      undefined,
      "No marker fixture reply",
      noMarkerRead.at(-1)!.id,
      () => true,
    );
    assert.equal(
      (await b.readConversation(c)).at(-1)?.text,
      "No marker fixture reply",
    );
    assert.equal(
      (await b.readLiveConversation(c)).at(-1)?.text,
      "Live fixture incoming",
    );
    // Wake/reconnect invalidation refreshes hidden pages, but never erases a browser draft.
    await worker.executeJavaScript(
      `document.querySelector('[contenteditable]').textContent='Keep browser draft'`,
    );
    b.invalidateSync(account.id);
    await assert.rejects(b.readConversation(c), /nội dung chưa gửi/);
    assert.equal(
      await worker.executeJavaScript(
        `document.querySelector('[contenteditable]').textContent`,
      ),
      "Keep browser draft",
    );
    await worker.executeJavaScript(
      `document.querySelector('[contenteditable]').textContent=''`,
    );
    serverText = "Synced after reconnect";
    assert.equal((await b.readConversation(c)).at(-1)?.text, serverText);
    assert.equal((await b.readLiveConversation(c)).at(-1)?.text, serverText);
    // A stale WebSocket is also bounded by a periodic page refresh.
    serverText = "Synced after stale connection";
    (
      b as unknown as { pageRefreshes: WeakMap<Electron.WebContents, number> }
    ).pageRefreshes.set(liveView, Date.now() - 61_000);
    assert.equal((await b.readLiveConversation(c)).at(-1)?.text, serverText);
    // Explicit history import keeps more than the normal recent read window.
    await b.readConversation(c);
    await worker.executeJavaScript(
      `(()=>{const timeline=document.querySelector('#timeline');timeline.innerHTML='';for(let n=0;n<120;n++){const article=document.createElement('div');article.setAttribute('role','article');article.innerHTML='<time datetime="'+new Date(Date.now()-120000+n*1000).toISOString()+'"></time><div role="button" aria-label="Nhập, Tin nhắn do Fixture Recipient gửi lúc 10:22: History '+n+'"></div>';timeline.append(article);}})()`,
    );
    const olderHistory = await b.readHistory(c);
    assert.equal(olderHistory.length, 120);
    assert.equal(olderHistory[0].text, "History 0");
    assert.equal(olderHistory.at(-1)?.text, "History 119");
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(b.readHistory(c, undefined, aborted.signal));
    await worker.executeJavaScript(
      `document.querySelector('[contenteditable]').setAttribute('aria-label','Viết cho Someone else')`,
    );
    await assert.rejects(
      b.send(c, undefined, "Stale recipient fixture", null, () => true),
      /Sai hội thoại/,
    );
    // Verified custom profiles get the same queue-local navigation and echo guards.
    profileFixture = true;
    const profile: DOMProfile = {
      version: 1,
      platform: "messenger-personal",
      verified: true,
      threadSelector: "section",
      threadIdAttribute: "data-thread",
      messageSelector: ".msg",
      messageIdAttribute: "data-id",
      textSelector: ".text",
      directionAttribute: "data-dir",
      incomingValue: "in",
      outgoingValue: "out",
      timestampAttribute: "data-time",
      composerSelector: "[contenteditable]",
      sendSelector: "#send",
      listSelector: "section",
      linkSelector: "a",
    };
    await worker.loadURL(c.url);
    const profileMessages = await b.readConversation(c, profile);
    const profileConversation = {
      ...c,
      messages: profileMessages.map((m) => ({ ...m, baseline: true })),
    };
    await worker.loadURL("https://www.facebook.com/messages/t/999/");
    await b.send(
      profileConversation,
      profile,
      "Profile queue reply",
      "profile-in",
      () => true,
    );
    assert.ok(worker.getURL().includes("/123/"));
    assert.equal(await worker.executeJavaScript("window.sends"), 1);
    assert.equal(
      (await b.readConversation(profileConversation, profile)).at(-1)?.text,
      "Profile queue reply",
    );
    await session.cookies.set({
      url: "https://www.facebook.com",
      name: "c_user",
      value: "different-fixture-user",
      domain: ".facebook.com",
      secure: true,
    });
    await assert.rejects(b.readConversation(c), /Phiên Facebook không khớp/);
    releaseFixture();
    await heldFixture;
    assert.equal(
      (b as unknown as { workers: Map<string, unknown> }).workers.size,
      0,
    );
    await session.cookies.set({
      url: "https://www.facebook.com",
      name: "c_user",
      value: "fixture-user",
      domain: ".facebook.com",
      secure: true,
    });
    // Separate conversations have independent pages in the same authenticated session.
    // A stalled browser task must not prevent another thread from finishing.
    profileFixture = false;
    const other = {
      ...c,
      id: "other-conversation",
      platformId: "456",
      url: "https://www.facebook.com/messages/t/456/",
    };
    let releaseFirst!: () => void, firstStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstTask = b.withConversationTask(c, async () => {
      firstStarted();
      await gate;
      return b.readConversation(c);
    });
    await started;
    try {
      const secondResult = await Promise.race([
        b.withConversationTask(other, async () => {
          const messages = await b.readConversation(other);
          await b.send(
            {
              ...other,
              messages: messages.map((m) => ({ ...m, baseline: true })),
            },
            undefined,
            "Concurrent second-thread reply",
            messages.at(-1)!.id,
            () => true,
          );
          const view = (
            b as unknown as { workers: Map<string, Electron.WebContentsView> }
          ).workers.get(other.id)!;
          assert.ok(view.webContents.getURL().includes("/456/"));
          assert.equal(
            await view.webContents.executeJavaScript("window.sends"),
            1,
          );
          return messages;
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Second conversation blocked by first")),
            5000,
          ),
        ),
      ]);
      assert.equal(secondResult[0].text, serverText);
      const workers = (
        b as unknown as { workers: Map<string, Electron.WebContentsView> }
      ).workers;
      assert.equal(workers.has(c.id), true);
      assert.equal(workers.has(other.id), false);
    } finally {
      releaseFirst();
    }
    await firstTask;
    assert.equal(
      (b as unknown as { workers: Map<string, unknown> }).workers.size,
      0,
    );
    assert.equal(
      (b as unknown as { monitors: Map<string, unknown> }).monitors.size,
      1,
    );
    // Reopening a page with a saved PIN restores a full-page prompt automatically.
    // The button enables after React's input update, not synchronously during fill.
    pinOnLoad = true;
    state.accounts[0].pinAutoFillBlocked = false;
    state.accounts[0].pinRestorePending = false;
    await b.withConversationTask(c, async () => {
      const restored = await b.readConversation(c);
      assert.equal(restored[0].text, "Restored on startup");
      const view = (
        b as unknown as { workers: Map<string, Electron.WebContentsView> }
      ).workers.get(c.id)!;
      assert.equal(
        await view.webContents.executeJavaScript("window.pinSubmits"),
        1,
      );
      assert.equal(state.accounts[0].pinAutoFillBlocked, false);
      assert.equal(state.accounts[0].pinRestorePending, false);
      // A previously pending success is recognized even by a fresh browser manager.
      state.accounts[0].pinAutoFillBlocked = true;
      state.accounts[0].pinRestorePending = true;
      const reopened = new Browsers(
        host,
        vault,
        () => {},
        () => {},
      );
      const restoreAfterReopen = (
        reopened as unknown as {
          restorePin(wc: Electron.WebContents, a: Account): Promise<string>;
        }
      ).restorePin.bind(reopened);
      assert.equal(
        await restoreAfterReopen(view.webContents, account),
        "absent",
      );
      assert.equal(state.accounts[0].pinAutoFillBlocked, false);
      assert.equal(state.accounts[0].pinRestorePending, false);
    });
    assert.equal(
      (b as unknown as { workers: Map<string, unknown> }).workers.size,
      0,
    );
    b.invalidateSync(account.id);
    const restoredInbox = await b.scanInbox(account.id);
    assert.equal(restoredInbox.threads.length, 1);
    assert.equal(state.accounts[0].pinAutoFillBlocked, false);
    // A full-page rate limit stops every background view for this account.
    // Repeated sync ticks must produce no further navigation or media requests.
    rateLimitedPage = true;
    b.invalidateSync(account.id);
    const pausesBeforeRateLimit = pauses;
    await assert.rejects(b.scanInbox(account.id), /Facebook tạm thời chặn/);
    assert.ok(pauses > pausesBeforeRateLimit);
    const requestsAfterRateLimit = pageRequests;
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(
        b.scanInbox(account.id),
        /Đồng bộ tài khoản đã dừng/,
      );
      await assert.rejects(b.readConversation(c), /Đồng bộ tài khoản đã dừng/);
      await assert.rejects(
        b.readLiveConversation(c),
        /Đồng bộ tài khoản đã dừng/,
      );
      await assert.rejects(
        b.readAttachment(c, "voice", "audio"),
        /Đồng bộ tài khoản đã dừng/,
      );
    }
    assert.equal(pageRequests, requestsAfterRateLimit);
    assert.equal(
      (b as unknown as { workers: Map<string, unknown> }).workers.size,
      0,
    );
    console.log(
      "Chromium fixture passed: virtualized inbox recipient proof, transient modal recovery, native/profile queue-local send and echo, pre-send failure classification, reconnect refresh, draft preservation, DOM/account guards, media, history and PIN no-retry guard.",
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

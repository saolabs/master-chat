import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  transcribeAudio,
  runTranscriptionProcess,
} from "../electron/transcription.ts";
import { emptyState, type TranscriptionSettings } from "../src/core/types.ts";
const audio = { kind: "audio" as const, mimeType: "audio/mp4", data: "AQID" };
const localConfig = () => {
  const ai = emptyState().ai;
  ai.providers = [
    {
      id: "stt",
      name: "Local speech",
      type: "openai_compatible",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "",
      enabled: true,
      allowRemote: false,
      models: ["whisper-small"],
      availableModels: [],
    },
  ];
  return ai;
};
test("local STT service is selected independently of the chat model and preserves language", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const ai = localConfig();
  ai.providers.push({
    ...ai.providers[0],
    id: "cloud",
    type: "google",
    baseUrl: "https://api.example.com",
    allowRemote: true,
    models: ["gemini"],
  });
  ai.default = { providerId: "cloud", modelId: "gemini" };
  globalThis.fetch = (async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:8080/v1/audio/transcriptions");
    const form = options!.body as FormData;
    assert.equal(form.get("model"), "whisper-small");
    assert.equal(form.get("language"), "vi");
    assert.equal(form.get("response_format"), "json");
    assert.equal(form.get("prompt"), null);
    return new Response(JSON.stringify({ text: "Tôi sẽ tới lúc mười giờ." }));
  }) as typeof fetch;
  assert.equal(
    await transcribeAudio(ai, audio, undefined, undefined, { language: "vi" }),
    "Tôi sẽ tới lúc mười giờ.",
  );
});
test("local mode never selects a remote transcriber or defaults to a chat model", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let calls = 0;
  const ai = localConfig();
  ai.providers[0].baseUrl = "https://api.example.com/v1";
  ai.providers[0].allowRemote = true;
  ai.default = { providerId: "stt", modelId: "whisper-small" };
  globalThis.fetch = (async () => {
    calls++;
    throw Error("Unexpected remote request");
  }) as typeof fetch;
  await assert.rejects(
    transcribeAudio(ai, audio, undefined, undefined, {
      mode: "local",
      executable: "/private/tmp/nonexistent-master-chat-whisper",
    }),
    /Chưa tìm thấy whisper-cli/,
  );
  assert.equal(calls, 0);
});
test("missing STT selection, non-audio, invalid language and oversized audio fail before any upload", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw Error("Unexpected");
  }) as typeof fetch;
  await assert.rejects(
    transcribeAudio(localConfig(), audio, undefined, undefined, {
      mode: "provider",
    }),
    /Chọn model/,
  );
  await assert.rejects(
    transcribeAudio(localConfig(), { ...audio, kind: "image" }),
    /Định dạng/,
  );
  await assert.rejects(
    transcribeAudio(localConfig(), audio, undefined, undefined, {
      language: "vi;rm",
    }),
    /Ngôn ngữ/,
  );
  await assert.rejects(
    transcribeAudio(localConfig(), {
      ...audio,
      data: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64"),
    }),
    /20 MB/,
  );
  assert.equal(calls, 0);
});
test("provider transcription bounds response size and never exposes provider body in errors", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const ai = localConfig(),
    override = { providerId: "stt", modelId: "whisper-small" };
  globalThis.fetch = (async () =>
    new Response("API_KEY private voice words", {
      status: 503,
    })) as typeof fetch;
  await assert.rejects(
    transcribeAudio(ai, audio, override),
    (e) => /HTTP 503/.test(String(e)) && !/private voice/.test(String(e)),
  );
  globalThis.fetch = (async () =>
    new Response("x".repeat(256001))) as typeof fetch;
  await assert.rejects(transcribeAudio(ai, audio, override), /quá dài/);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ text: "" }))) as typeof fetch;
  await assert.rejects(transcribeAudio(ai, audio, override), /rỗng/);
});
async function fixtures() {
  const directory = await mkdtemp(path.join(tmpdir(), "master-chat-stt-test-"));
  const model = path.join(directory, "model ; literal $.bin"),
    ffmpeg = path.join(directory, "fake-ffmpeg"),
    whisper = path.join(directory, "fake-whisper");
  await writeFile(model, "fixture model");
  await writeFile(
    ffmpeg,
    `#!/usr/bin/env node\nconst fs=require('node:fs'); const args=process.argv.slice(2); const input=args[args.indexOf('-i')+1];fs.writeFileSync(${JSON.stringify(path.join(directory, "paths.json"))},JSON.stringify({ input, args, mode:fs.statSync(input).mode & 511, directoryMode:fs.statSync(require('node:path').dirname(input)).mode & 511 }));fs.writeFileSync(args.at(-1), Buffer.alloc(1000));`,
    { mode: 0o700 },
  );
  await writeFile(
    whisper,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);if(!fs.existsSync(args[args.indexOf('-m')+1])||args.includes('-tr'))process.exit(1);fs.writeFileSync(args[args.indexOf('-of')+1]+'.txt','Hẹn bạn lúc mười giờ nhé.');`,
    { mode: 0o700 },
  );
  return {
    directory,
    settings: {
      mode: "local",
      executable: whisper,
      modelPath: model,
      ffmpegPath: ffmpeg,
      language: "vi",
    } as TranscriptionSettings,
  };
}
test("local pipeline isolates temporary files, converts before Whisper, preserves words, and cleans on success", async (t) => {
  const f = await fixtures();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  assert.equal(
    await transcribeAudio(
      emptyState().ai,
      audio,
      undefined,
      undefined,
      f.settings,
    ),
    "Hẹn bạn lúc mười giờ nhé.",
  );
  const trace = JSON.parse(
    await readFile(path.join(f.directory, "paths.json"), "utf8"),
  );
  assert.equal(trace.mode, 0o600);
  assert.equal(trace.directoryMode, 0o700);
  assert.ok(trace.args.includes("16000"));
  assert.ok(trace.args.includes("pcm_s16le"));
  assert.deepEqual(
    trace.args.slice(
      trace.args.indexOf("-protocol_whitelist"),
      trace.args.indexOf("-protocol_whitelist") + 2,
    ),
    ["-protocol_whitelist", "file,pipe"],
  );
  await assert.rejects(access(path.dirname(trace.input)));
});
test("local transcription failure cleans decoded audio without leaking the child output", async (t) => {
  const f = await fixtures();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  await writeFile(
    f.settings.executable!,
    '#!/usr/bin/env node\nconsole.error("PRIVATE_TRANSCRIPT");process.exit(1);',
    { mode: 0o700 },
  );
  await assert.rejects(
    transcribeAudio(emptyState().ai, audio, undefined, undefined, f.settings),
    (e) =>
      /Không chạy được/.test(String(e)) &&
      !String(e).includes("PRIVATE_TRANSCRIPT"),
  );
  const trace = JSON.parse(
    await readFile(path.join(f.directory, "paths.json"), "utf8"),
  );
  await assert.rejects(access(path.dirname(trace.input)));
});
test("pause aborts a running local subprocess promptly", async () => {
  const controller = new AbortController();
  const pending = runTranscriptionProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    300000,
    controller.signal,
  );
  controller.abort(new Error("Paused by owner"));
  await assert.rejects(pending, /Paused by owner/);
});
test("real FFmpeg decodes an M4A voice fixture to mono 16 kHz WAV before the recognizer", async (t) => {
  const ffmpeg = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ].find((file) => {
    try {
      execFileSync(file, ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!ffmpeg) {
    t.skip("FFmpeg not installed on this test host");
    return;
  }
  const f = await fixtures();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const input = path.join(f.directory, "sample.m4a");
  execFileSync(ffmpeg, [
    "-nostdin",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "aac",
    input,
  ]);
  await writeFile(
    f.settings.executable!,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);const wav=fs.readFileSync(a[a.indexOf('-f')+1]);if(wav.toString('ascii',0,4)!=='RIFF'||wav.readUInt32LE(24)!==16000||wav.readUInt16LE(22)!==1)process.exit(2);fs.writeFileSync(a[a.indexOf('-of')+1]+'.txt','Decode verified');`,
    { mode: 0o700 },
  );
  const result = await transcribeAudio(
    emptyState().ai,
    {
      kind: "audio",
      mimeType: "audio/mp4",
      data: (await readFile(input)).toString("base64"),
    },
    undefined,
    undefined,
    { ...f.settings, ffmpegPath: ffmpeg },
  );
  assert.equal(result, "Decode verified");
});

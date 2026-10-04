#!/usr/bin/env bash
# Build the offline recognizer in the project; no system install or user-data upload.
set -euo pipefail
master_chat_root="$(cd "$(dirname "$0")/.." && pwd)"
master_chat_platform="$(node -p 'process.platform')"
master_chat_arch="$(node -p 'process.arch')"
master_chat_target="$master_chat_root/runtime/speech/$master_chat_platform-$master_chat_arch"
master_chat_cmake="${MASTER_CHAT_CMAKE:-cmake}"
master_chat_work="$(mktemp -d)"
trap 'rm -rf "$master_chat_work"' EXIT
mkdir -p "$master_chat_target"
curl --fail --location --silent --show-error https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v1.9.4 -o "$master_chat_work/source.tar.gz"
mkdir "$master_chat_work/source"
tar -xzf "$master_chat_work/source.tar.gz" -C "$master_chat_work/source" --strip-components=1
"$master_chat_cmake" -S "$master_chat_work/source" -B "$master_chat_work/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
"$master_chat_cmake" --build "$master_chat_work/build" --target whisper-cli -j 4
cp "$master_chat_work/build/bin/whisper-cli" "$master_chat_target/whisper-cli"
cp "$master_chat_work/source/LICENSE" "$master_chat_target/WHISPER-LICENSE.txt"
if [ ! -f "$master_chat_target/ggml-base.bin" ]; then
  curl --fail --location --silent --show-error https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o "$master_chat_target/ggml-base.bin.part"
else
  cp "$master_chat_target/ggml-base.bin" "$master_chat_target/ggml-base.bin.part"
fi
node - "$master_chat_target" <<'JS'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.argv[2], part = path.join(root, 'ggml-base.bin.part');
const hash = crypto.createHash('sha256').update(fs.readFileSync(part)).digest('hex');
if(hash !== '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe') throw Error('Model SHA256 mismatch; refusing to package');
fs.renameSync(part, path.join(root, 'ggml-base.bin'));
fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify({whisperVersion:'v1.9.4', model:'base multilingual', modelSHA256:hash, modelSource:'https://huggingface.co/ggerganov/whisper.cpp', platform:process.platform, arch:process.arch},null,2));
console.log('Offline speech runtime ready:', root);
JS

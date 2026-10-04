import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function seal(text: string, key: Buffer): Buffer {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from("MC01"),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export function unseal(data: Buffer, key: Buffer): string {
  if (data.length < 32 || data.subarray(0, 4).toString() !== "MC01")
    throw new Error("Vault không hợp lệ.");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
  decipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([
    decipher.update(data.subarray(32)),
    decipher.final(),
  ]).toString("utf8");
}

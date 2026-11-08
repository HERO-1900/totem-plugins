// Sealing the cloud copy (C). The computer seals every item before it leaves; the relay keeps only
// sealed blobs under names it can't read. The key lives on the computer (~/.totem/link.json) and, for
// each linked AI, inside that AI's OAuth grant, which the OAuth library encrypts with the AI's own
// token. So the relay can open the copy only while a linked AI is asking, and a copy of the relay's
// storage on its own opens nothing.
//
// Pure WebCrypto (AES-256-GCM, HMAC-SHA-256, HKDF-SHA-256): the same file runs in Node and in the Worker.

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export function toB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(s) {
  const bin = atob(String(s));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// 32 random bytes, base64. Made once per computer.
export const newCopyKey = () => toB64(globalThis.crypto.getRandomValues(new Uint8Array(32)));

// Two keys from the one secret: one seals, one names. Changing "v1" starts a new copy.
export async function copyKeys(keyB64) {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("bad copy key");
  const base = await subtle().importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const derive = (info, alg, uses) => subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: te.encode(info) }, base, alg, false, uses);
  return {
    seal: await derive("totem/c/v1/seal", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    name: await derive("totem/c/v1/name", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
  };
}

// The storage name for one item: the relay sees "ci:" and 32 hex characters, never the item's id.
export async function nameFor(keys, kind, id) {
  return `${kind}:${hex(await subtle().sign("HMAC", keys.name, te.encode(`${kind}\n${id}`))).slice(0, 32)}`;
}

// The name is bound into the seal, so a blob moved to another name won't open.
export async function seal(keys, name, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: te.encode(name) }, keys.seal, te.encode(JSON.stringify(value))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

export async function open(keys, name, sealed) {
  const u8 = fromB64(sealed);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12), additionalData: te.encode(name) }, keys.seal, u8.subarray(12));
  return JSON.parse(td.decode(pt));
}

import fs from "node:fs";
import { PROFILE, RECEIPTS, ensureDirs } from "./paths.js";

export function loadProfile() {
  try { return JSON.parse(fs.readFileSync(PROFILE, "utf8")); } catch { return null; }
}

export function saveProfile(p) {
  ensureDirs();
  fs.writeFileSync(PROFILE, JSON.stringify(p, null, 2), { mode: 0o600 });
}

export function addReceipt(r) {
  ensureDirs();
  fs.appendFileSync(RECEIPTS, JSON.stringify({ at: new Date().toISOString(), ...r }) + "\n", { mode: 0o600 });
}

export function loadReceipts(limit = 200) {
  try {
    return fs.readFileSync(RECEIPTS, "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((l) => JSON.parse(l)).reverse();
  } catch { return []; }
}

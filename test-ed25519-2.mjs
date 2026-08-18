import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

async function run() {
  try {
    (ed).hashes ||= {};
    (ed).hashes.sha512 = sha512;
    const seed = new Uint8Array(32);
    const pub = ed.getPublicKey(seed);
    console.log("pub:", pub);
  } catch(e) {
    console.error("ERROR:", e);
  }
}
run();

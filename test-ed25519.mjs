import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

async function run() {
  try {
    // noble-ed25519 v3+ requires setting sha512Sync if using sync functions
    // but in v3, we can just use signAsync
    const seed = new Uint8Array(32);
    const pub = await ed.getPublicKeyAsync(seed);
    console.log("pub:", pub);
  } catch(e) {
    console.error(e);
  }
}
run();

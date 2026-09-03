const crypto = require('crypto');

async function generateKeys() {
  const ed = await import("@noble/ed25519");
  const { sha512 } = await import("@noble/hashes/sha2.js");
  
  // Apply noble hashes for ed25519 v3+ compatibility
  (ed as any).hashes ||= {};
  (ed as any).hashes.sha512 = sha512;

  // Generate a random 32-byte seed
  const seed = crypto.randomBytes(32);
  
  // Get public key
  const publicKey = await ed.getPublicKey(seed);
  
  console.log('--- AIVRASOL LICENSE STATUS KEYS ---');
  console.log();
  console.log('1. LICENSE_STATUS_SIGNING_SEED (Save this in your .env.local):');
  console.log(seed.toString('hex'));
  console.log();
  console.log('2. PUBLIC KEY (Base64) (Provide this to POS developers):');
  console.log(Buffer.from(publicKey).toString('base64'));
  console.log();
  console.log('------------------------------------');
}

generateKeys().catch(console.error);

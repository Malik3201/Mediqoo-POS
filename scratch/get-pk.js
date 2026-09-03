require('dotenv').config();
const ed = require('@noble/ed25519');
const crypto = require('crypto');

async function getPK() {
  const seedInput = process.env.LICENSE_STATUS_SIGNING_SEED;
  if (!seedInput) {
    console.log('NO SEED');
    return;
  }
  let seed;
  const hex = seedInput.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length >= 64) {
    seed = Buffer.from(hex.slice(0, 64), 'hex');
  } else {
    seed = crypto.createHash('sha256').update(seedInput).digest();
  }
  const pk = await ed.getPublicKey(seed);
  console.log('B64 PK:', Buffer.from(pk).toString('base64'));
  console.log('HEX PK:', Buffer.from(pk).toString('hex'));
}
getPK();

// Makes the VAPID key pair Web Push needs: node scripts/vapid-keys.mjs
// The public key goes in Coolify (VAPID_PUBLIC_KEY, for the page) and in the remind Edge Function.
// The private key goes ONLY in the Edge Function's secrets. Never commit it or put it in the page.
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
assert.equal(raw.length, 65); assert.equal(Buffer.from(priv.d, 'base64url').length, 32); // the sizes web-push expects
console.log(`VAPID_PUBLIC_KEY=${raw.toString('base64url')}\nVAPID_PRIVATE_KEY=${priv.d}`);

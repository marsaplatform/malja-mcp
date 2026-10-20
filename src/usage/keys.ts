/**
 * Free Malja MCP API keys.
 *
 * The server stays fully open — anonymous calls always work under the per-IP
 * rate limit. A free key (issued after a one-field email sign-up on the
 * storefront) simply attributes usage to a subject and lifts the anonymous
 * rate limit up to a generous monthly ceiling. There is no paywall.
 *
 * Keys are stateless: `hm_<customerId>_<hmac16>`, where the signature is an
 * HMAC over the id with MALJA_KEY_SECRET (shared only with the issuing store).
 * No key database exists; a cancelled account fails the monthly-cap lookup at
 * the billing layer, not here.
 */

const KEY_PATTERN = /^hm_(\d{1,10})_([0-9a-f]{16})$/;

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function deriveFreeKey(customerId: number, secret: string): Promise<string> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error('invalid customer id');
  const sig = (await hmacHex(`hm-key:${customerId}`, secret)).slice(0, 16);
  return `hm_${customerId}_${sig}`;
}

/** Billing subject for a valid key, else null. */
export async function verifyFreeKey(key: string, secret: string): Promise<string | null> {
  const match = KEY_PATTERN.exec(key.trim());
  if (!match) return null;
  const expected = (await hmacHex(`hm-key:${match[1]}`, secret)).slice(0, 16);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= expected.charCodeAt(i) ^ match[2].charCodeAt(i);
  return diff === 0 ? `wp:customer-${match[1]}` : null;
}

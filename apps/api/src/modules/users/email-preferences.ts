import { createHmac } from 'crypto';
import { env } from '../../config/env';
import { apiPublicUrl, safeEqual, UUID_RE } from '../auth/auth.util';

/**
 * One-click email unsubscribe links (RFC 8058). Deliberately NOT a JWT: a JWT signed with JWT_SECRET would be accepted as
 * a session cookie, and unsubscribe links get forwarded. This is an HMAC over the user id with a purpose-derived key.
 *
 * Notifications can add to every email:
 *   List-Unsubscribe: <unsubscribeUrl(userId)>
 *   List-Unsubscribe-Post: List-Unsubscribe=One-Click
 */
function key(): Buffer {
  return createHmac('sha256', env().JWT_SECRET).update('ctn:email-unsubscribe:v1').digest();
}

function sign(userId: string): string {
  return createHmac('sha256', key()).update(userId).digest('base64url').slice(0, 32);
}

export function unsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString('base64url')}.${sign(userId)}`;
}

export function unsubscribeUrl(userId: string): string {
  return apiPublicUrl(`/email/unsubscribe/${unsubscribeToken(userId)}`);
}

/** The user id the token was issued for, or null when it is malformed or forged. */
export function verifyUnsubscribeToken(token: string): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [idPart, sig] = token.split('.');
  if (!idPart || !sig) return null;
  const userId = Buffer.from(idPart, 'base64url').toString('utf8');
  if (!UUID_RE.test(userId)) return null;
  return safeEqual(sig, sign(userId)) ? userId : null;
}

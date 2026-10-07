import { NextResponse, type NextRequest } from 'next/server';

/**
 * Legacy / e-mail deep links: the API's one-click e-mail unsubscribe redirects to /app/settings?emailUnsubscribed=…,
 * which lives at /app/profile (alerts section) in the web app.
 */
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = '/app/profile';
  url.hash = 'alerts';
  return NextResponse.redirect(url, 307);
}

export const config = { matcher: ['/app/settings', '/app/settings/:path*'] };

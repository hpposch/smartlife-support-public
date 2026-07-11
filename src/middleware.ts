import { NextRequest, NextResponse } from "next/server";

// Schneller Redirect für nicht eingeloggte Besucher. Die eigentliche
// Session-Prüfung passiert serverseitig in requireUser() auf jeder Seite.
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has("smartlife_support_session");
  if (!hasSession && request.nextUrl.pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // API-Routen (eigene Auth) und statische Dateien ausnehmen
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

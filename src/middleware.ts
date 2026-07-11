import { NextRequest, NextResponse } from "next/server";

// Schneller Redirect für nicht eingeloggte Besucher des Agenten-Bereichs.
// Die eigentliche Session-Prüfung passiert serverseitig in requireUser()
// bzw. requireContact() auf jeder Seite.
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
  // Öffentliche Bereiche (Portal, Wissensdatenbank) und Routen mit eigener
  // Auth (API, Anhänge) sind ausgenommen
  matcher: ["/((?!api|portal|kb|attachments|_next/static|_next/image|favicon.ico).*)"],
};

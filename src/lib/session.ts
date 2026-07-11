import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { env } from "./env";

export interface SessionData {
  userId?: string;
}

export const sessionOptions: SessionOptions = {
  cookieName: "smartlife_support_session",
  password: env.sessionSecret,
  ttl: 60 * 60 * 24 * 14, // 14 Tage
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

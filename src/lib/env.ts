function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get sessionSecret() {
    const secret = required("SESSION_SECRET");
    if (secret.length < 32) throw new Error("SESSION_SECRET muss mindestens 32 Zeichen haben");
    return secret;
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get dataDir() {
    return process.env.DATA_DIR ?? "./data";
  },
  get apiKey() {
    return process.env.API_KEY ?? "";
  },
};

/** Löst den credentialsRef einer Mailbox zur ENV-Variable mit dem Passwort auf. */
export function mailboxPassword(credentialsRef: string): string {
  return required(credentialsRef);
}

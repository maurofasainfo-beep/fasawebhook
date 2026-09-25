import 'server-only';

export function config() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEY;
  const appUrl = new URL(process.env.APP_PUBLIC_URL || 'http://localhost:3000');
  const maxPayload = Number(process.env.WEBHOOK_MAX_PAYLOAD_SIZE || 1048576);
  if (!supabaseUrl || !serviceKey || !encryptionKey || !/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error('SERVER_CONFIGURATION');
  }
  const databaseUrl = new URL(supabaseUrl);
  if (!['http:', 'https:'].includes(databaseUrl.protocol) || databaseUrl.username || databaseUrl.password ||
      !['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password ||
      appUrl.pathname !== '/' || appUrl.search || appUrl.hash ||
      !Number.isInteger(maxPayload) || maxPayload < 1 || maxPayload > 10485760) throw new Error('SERVER_CONFIGURATION');
  return { supabaseUrl, serviceKey, encryptionKey, appUrl: appUrl.origin, maxPayload, trustProxy: process.env.WEBHOOK_TRUST_PROXY === 'true' };
}

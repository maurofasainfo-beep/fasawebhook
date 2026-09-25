import { config } from '@/lib/config';
import { json, pageNumber, readJson, requireDashboard, safe } from '@/lib/http';
import { repository } from '@/services/repository';
import { createWebhook, present } from '@/services/webhooks';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    const env = config(); requireDashboard(request, env.appUrl);
    const result = await repository().list(pageNumber(request.url));
    return json({ ...result, items: result.items.map(row => present(row, env.appUrl, env.encryptionKey)) });
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const env = config(); requireDashboard(request, env.appUrl);
    const row = await createWebhook(repository(), await readJson(request, 4096), env.encryptionKey);
    return json(present(row, env.appUrl, env.encryptionKey), 201);
  });
}

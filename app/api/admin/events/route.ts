import { config } from '@/lib/config';
import { HttpError, isUuid, json, pageNumber, requireDashboard, safe, readJson } from '@/lib/http';
import { repository } from '@/services/repository';
import { clearWebhookEvents } from '@/services/webhooks';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    requireDashboard(request, config().appUrl);
    const webhookId = new URL(request.url).searchParams.get('webhookId');
    if (!webhookId || !isUuid(webhookId)) throw new HttpError(400, 'Selecione um webhook para ver os logs.');
    return json(await repository().events(pageNumber(request.url), webhookId));
  });
}
export async function DELETE(request: Request) {
  return safe(async () => {
    const env = config(); requireDashboard(request, env.appUrl);
    const webhookId = new URL(request.url).searchParams.get('webhookId');
    if (!webhookId || !isUuid(webhookId)) throw new HttpError(400, 'Selecione um webhook para limpar os logs.');
    return json(await clearWebhookEvents(repository(), webhookId, await readJson(request, 4096)));
  });
}

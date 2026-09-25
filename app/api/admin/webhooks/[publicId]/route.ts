import { config } from '@/lib/config';
import { HttpError, isUuid, json, readJson, requireDashboard, safe } from '@/lib/http';
import { repository } from '@/services/repository';
import { present, updateWebhook } from '@/services/webhooks';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ publicId: string }> }) {
  return safe(async () => {
    const env = config(); requireDashboard(request, env.appUrl);
    const { publicId } = await context.params;
    if (!isUuid(publicId)) throw new HttpError(404, 'Webhook não encontrado.');
    const row = await updateWebhook(repository(), publicId, await readJson(request, 4096));
    return json(present(row, env.appUrl, env.encryptionKey));
  });
}

import { config } from '@/lib/config';
import { HttpError, isUuid, json, requireDashboard, safe } from '@/lib/http';
import { repository } from '@/services/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    requireDashboard(request, config().appUrl);
    const { id } = await context.params;
    if (!isUuid(id)) throw new HttpError(404, 'Evento não encontrado.');
    const event = await repository().event(id);
    if (!event) throw new HttpError(404, 'Evento não encontrado.');
    return json(event);
  });
}

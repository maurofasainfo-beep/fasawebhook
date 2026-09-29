import { config } from '@/lib/config';
import { json, pageNumber, requireDashboard, safe } from '@/lib/http';
import { repository } from '@/services/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    requireDashboard(request, config().appUrl);
    return json(await repository().options(pageNumber(request.url)));
  });
}

import { config } from '@/lib/config';
import { json, safe } from '@/lib/http';
import { repository } from '@/services/repository';
import { receive } from '@/services/receiver';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  return safe(async () => {
    const env = config();
    return receive(request, (await context.params).publicId, repository(), env);
  });
}
const methodNotAllowed = () => json({ success: false, error: 'Utilize POST.' }, 405, { Allow: 'POST' });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE, methodNotAllowed as OPTIONS, methodNotAllowed as HEAD };

import type { APIRoute } from 'astro';
import { ADMIN_COOKIE } from '../../../lib/booking/admin-auth.ts';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete(ADMIN_COOKIE, { path: '/' });
  return new Response(null, { status: 302, headers: { Location: '/admin/signin' } });
};

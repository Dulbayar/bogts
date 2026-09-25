import { redirect } from '@sveltejs/kit';
import { ADMIN_SESSION_COOKIE } from '$lib/server/auth/admin';
import type { RequestHandler } from './$types';

/** Clears the password session. (In Access mode, sign out through Access.) */
export const POST: RequestHandler = ({ cookies }) => {
	cookies.delete(ADMIN_SESSION_COOKIE, { path: '/admin' });
	redirect(303, '/admin/login');
};

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The bare origin is the operator's: send them to the dashboard. */
export const GET: RequestHandler = () => redirect(303, '/admin');

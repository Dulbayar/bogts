/** Links that keep the current query (project scope, filters) while changing some params. */
export function withParams(url: URL, changes: Record<string, string | null | undefined>, pathname = url.pathname): string {
	const params = new URLSearchParams(url.searchParams);
	for (const [k, v] of Object.entries(changes)) {
		if (v === null || v === undefined || v === '') params.delete(k);
		else params.set(k, v);
	}
	const q = params.toString();
	return q ? `${pathname}?${q}` : pathname;
}

/** `path?project=<id>` when scoped. */
export function scopedHref(path: string, projectId: string | null | undefined): string {
	return projectId ? `${path}${path.includes('?') ? '&' : '?'}project=${projectId}` : path;
}

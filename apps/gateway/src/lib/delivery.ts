/** Human classes for a delivery's last error code (ux-brief §7.6). */
export function errorClass(code: string | null | undefined, status?: number | null): string | null {
	if (status && status >= 200 && status < 300) return null;
	if (!code) {
		if (status && status >= 500) return 'HTTP 5xx';
		if (status && status >= 400) return 'HTTP 4xx';
		return null;
	}
	const c = code.toLowerCase();
	if (c === 'no_webhook_url') return 'no webhook URL';
	if (c.includes('timeout')) return 'timeout';
	if (c.includes('refused') || c.includes('connect')) return 'connection refused';
	if (c.includes('dns')) return 'DNS';
	if (c.includes('tls') || c.includes('ssl') || c.includes('cert')) return 'TLS';
	const m = /^http_(\d)/.exec(c);
	if (m) return `HTTP ${m[1]}xx`;
	return code;
}

/** Tint for a response cell: 2xx success, 4xx warning, 5xx/network danger. */
export function responseTone(status: number | null | undefined, code: string | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
	if (status && status >= 200 && status < 300) return 'success';
	if (code === 'no_webhook_url') return 'muted';
	if (status && status >= 400 && status < 500) return 'warning';
	if (status || code) return 'danger';
	return 'muted';
}

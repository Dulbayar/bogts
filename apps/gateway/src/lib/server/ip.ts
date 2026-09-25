/**
 * The rate-limit bucket for a client address: the full address for IPv4, the
 * /64 prefix for IPv6 (one subscriber usually holds a whole /64, so keying on
 * the full address would let one client rotate through buckets).
 */
export function ipRateKey(address: string | null | undefined): string {
	const raw = (address ?? '').trim().replace(/%.*$/, '').toLowerCase();
	if (!raw) return 'unknown';
	if (!raw.includes(':')) return raw;
	// IPv4-mapped IPv6 (::ffff:1.2.3.4) is an IPv4 client.
	const mapped = /^(?:0*:)*:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
	if (mapped?.[1]) return mapped[1];
	const [head, tail] = raw.split('::', 2);
	const left = head ? head.split(':') : [];
	const right = tail ? tail.split(':') : [];
	// A trailing embedded IPv4 counts as two groups; it never reaches the first four.
	const rightLen = right.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
	const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - rightLen)).fill('0'), ...right] : left;
	const prefix = groups.slice(0, 4).map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? g.replace(/^0+(?=.)/, '') : '0'));
	while (prefix.length < 4) prefix.push('0');
	return `${prefix.join(':')}::/64`;
}

import { describe, expect, it } from 'vitest';
import { ipRateKey } from './ip';

describe('ipRateKey', () => {
	it('keeps a full IPv4 address', () => {
		expect(ipRateKey('203.0.113.7')).toBe('203.0.113.7');
		expect(ipRateKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
	});

	it('keys IPv6 on the /64', () => {
		const a = ipRateKey('2001:db8:abcd:12:1:2:3:4');
		expect(a).toBe('2001:db8:abcd:12::/64');
		expect(ipRateKey('2001:0db8:abcd:0012:ffff::1')).toBe(a);
		expect(ipRateKey('2001:DB8:ABCD:12::9')).toBe(a);
		expect(ipRateKey('2001:db8:abcd:13::1')).not.toBe(a);
		expect(ipRateKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
		expect(ipRateKey('::1')).toBe('0:0:0:0::/64');
		expect(ipRateKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
	});

	it('falls back to one shared bucket', () => {
		expect(ipRateKey('')).toBe('unknown');
		expect(ipRateKey(undefined)).toBe('unknown');
	});
});

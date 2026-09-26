import { describe, expect, it } from 'vitest';
import { bankTiles, titleCase } from './banks';

/** QPay's deeplinks in QPay's own order and casing. */
const QPAY = [
	{ name: 'qPay wallet', link: 'qpaywallet://q?qPay_QRcode=x' },
	{ name: 'Khan bank', description: 'Хаан банк', link: 'khanbank://q?qPay_QRcode=x' },
	{ name: 'State bank 3.0', link: 'statebankapp://q?qPay_QRcode=x' },
	{ name: 'Xac bank', link: 'xacbank://q?qPay_QRcode=x' },
	{ name: 'Trade and Development bank', description: 'TDB online', link: 'tdbbank://q?qPay_QRcode=x' },
	{ name: 'Social Pay', description: 'Голомт банк', link: 'socialpay-payment://q?qPay_QRcode=x' },
	{ name: 'Most money', link: 'most://q?qPay_QRcode=x' },
	{ name: 'National investment bank', link: 'nibank://q?qPay_QRcode=x' },
	{ name: 'Capitron bank', link: 'capitronbank://q?qPay_QRcode=x' },
	{ name: 'M bank', link: 'mbank://q?qPay_QRcode=x' },
	{ name: 'Monpay', link: 'Monpay://q?qPay_QRcode=x' },
	{ name: 'Chinggis khaan bank', link: 'ckbank://q?qPay_QRcode=x' }
];

describe('bankTiles', () => {
	it('puts the popular apps first, in order, then the rest in QPay order', () => {
		expect(bankTiles(QPAY).map((b) => b.label)).toEqual([
			'Social Pay',
			'Khan Bank',
			'M Bank',
			'TDB',
			'Xac Bank',
			'Capitron Bank',
			'Monpay',
			'State Bank 3.0',
			'QPay Wallet',
			'Most Money',
			'National Investment Bank',
			'Chinggis Khaan Bank'
		]);
	});

	it('keeps links and logos with their bank', () => {
		const tdb = bankTiles(QPAY).find((b) => b.label === 'TDB');
		expect(tdb?.link).toBe('tdbbank://q?qPay_QRcode=x');
	});

	it('recognises a bank by its scheme when QPay renames it', () => {
		expect(bankTiles([{ name: 'Other', link: 'x://' }, { name: 'TDB online', link: 'tdbbank://q' }])[0]?.label).toBe('TDB');
	});

	it('fills the first eight with the next banks when popular ones are missing', () => {
		const without = QPAY.filter((b) => !['Social Pay', 'M bank', 'Monpay'].includes(b.name));
		expect(bankTiles(without).slice(0, 8).map((b) => b.label)).toEqual([
			'Khan Bank',
			'TDB',
			'Xac Bank',
			'Capitron Bank',
			'State Bank 3.0',
			'QPay Wallet',
			'Most Money',
			'National Investment Bank'
		]);
	});

	it('handles fewer banks than the grid holds', () => {
		expect(bankTiles([{ name: 'Khan bank', link: 'khanbank://q' }]).map((b) => b.label)).toEqual(['Khan Bank']);
	});
});

describe('titleCase', () => {
	it('capitalises words but keeps small words and existing capitals', () => {
		expect(titleCase('trade and development bank')).toBe('Trade and Development Bank');
		expect(titleCase('qPay wallet')).toBe('QPay Wallet');
		expect(titleCase('  Ard  app ')).toBe('Ard App');
		expect(titleCase('Голомт банк')).toBe('Голомт банк');
	});
});

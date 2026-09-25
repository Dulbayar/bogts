#!/usr/bin/env node
/**
 * Writes apps/gateway/pnpm-lock.yaml: a standalone lockfile for the gateway.
 *
 * Why: the Deploy to Cloudflare button copies only apps/gateway into a new
 * repository and installs it there, so that folder needs a lockfile of its own.
 * The workspace ignores it (pnpm uses the root pnpm-lock.yaml inside the
 * workspace); only a standalone copy of apps/gateway reads it.
 *
 * How: take the root lockfile, keep only the `apps/gateway` importer (renamed to
 * `.`), and let pnpm prune it with `--lockfile-only --ignore-workspace` in a
 * temporary copy. Every version stays exactly what the workspace resolved.
 *
 *   node scripts/gateway-lockfile.mjs          write it
 *   node scripts/gateway-lockfile.mjs --check  fail if it is out of date (CI)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gateway = join(root, 'apps/gateway');
const target = join(gateway, 'pnpm-lock.yaml');
const check = process.argv.includes('--check');

/** The root lockfile with only the gateway's importer, as the project root. */
function seedLockfile(text) {
	// pnpm 11+ may prepend a document for its own version (`packageManager`);
	// the project's lockfile is the document that has the gateway importer.
	const doc = text.split(/^---$/m).find((d) => /^ {2}apps\/gateway:$/m.test(d));
	if (!doc) throw new Error('no apps/gateway importer in pnpm-lock.yaml');
	const lines = doc.replace(/^\n/, '').split('\n');
	const start = lines.indexOf('importers:');
	const end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && l !== '');
	if (start < 0 || end < 0) throw new Error('unexpected pnpm-lock.yaml layout: no importers block');
	const importers = [];
	let keep = false;
	for (const line of lines.slice(start + 1, end)) {
		const head = /^ {2}(\S.*):(?: \{\})?$/.exec(line);
		if (head) {
			keep = head[1] === 'apps/gateway';
			if (keep) importers.push('  .:');
			continue;
		}
		if (keep) importers.push(line);
	}
	if (importers.length === 0) throw new Error('no apps/gateway importer in pnpm-lock.yaml');
	return [...lines.slice(0, start + 1), '', ...importers, ...lines.slice(end)].join('\n');
}

const dir = mkdtempSync(join(tmpdir(), 'bogts-gateway-lock-'));
try {
	copyFileSync(join(gateway, 'package.json'), join(dir, 'package.json'));
	writeFileSync(join(dir, 'pnpm-lock.yaml'), seedLockfile(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')));
	execFileSync(
		'pnpm',
		['install', '--lockfile-only', '--ignore-workspace', '--ignore-scripts', '--prefer-offline'],
		{ cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] }
	);
	const fresh = readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8');
	if (check) {
		let current = '';
		try {
			current = readFileSync(target, 'utf8');
		} catch {
			/* missing */
		}
		if (current !== fresh) {
			console.error('apps/gateway/pnpm-lock.yaml is out of date. Run: pnpm lockfile:gateway');
			process.exit(1);
		}
		console.log('apps/gateway/pnpm-lock.yaml is up to date');
	} else {
		writeFileSync(target, fresh);
		console.log('wrote apps/gateway/pnpm-lock.yaml');
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

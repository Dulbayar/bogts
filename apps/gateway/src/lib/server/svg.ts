/**
 * The SVG logo sanitiser: an allowlist, not a blocklist.
 *
 * The upload is tokenised by a small XML reader and a fresh document is
 * written from what it read. Only allowlisted element and attribute names are
 * ever written, every attribute value and text node is escaped on the way
 * out, and no input byte is copied through unparsed. So one pass is safe by
 * construction: there is nothing to run to a fixed point.
 *
 *  - Skipped: the XML declaration, processing instructions, the DOCTYPE (with
 *    its internal subset; declared entities are never expanded), comments and
 *    CDATA outside `<style>`.
 *  - Elements outside the allowlist are dropped with their content (`<a>` and
 *    `<switch>` are unwrapped, keeping their allowed children, so Illustrator's
 *    `<switch><foreignObject …/><g>…</g></switch>` keeps its drawing).
 *  - Scripts and images (`<script>`, `<image>`, `<iframe>`, …) are refused
 *    outright: dropping them would save a blank or broken logo.
 *  - Attributes: presentation and geometry only. An `href` or `src` under any
 *    prefix survives only as a same-document `#id` (written as `href`).
 *  - Values: numeric and the five XML entities are decoded first, then a value
 *    survives only if it uses a small character set (no `:`, `\`, `;`, `@`,
 *    `*`, `<`, `&`), and only known functions, with `url()` pointing at a
 *    `#id`.
 *  - `<style>`: simple class rules (`.cls-1, .cls-2 { fill: #abc }`) and the
 *    `style` attribute become presentation attributes on the elements, in CSS
 *    order (attribute < class rule < inline style); everything else is
 *    ignored and the `<style>` element is dropped.
 */
import { ApiError } from './api/errors';

export const SVG_UNSAFE_MESSAGE = 'This SVG embeds images or scripts; export it as plain vector or upload a PNG';

const unreadable = () => new ApiError(400, 'invalid_request', 'Logo: the SVG could not be read');
const unsafe = () => new ApiError(400, 'invalid_request', SVG_UNSAFE_MESSAGE);

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_DEPTH = 128;

const ELEMENTS = new Set([
	'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan',
	'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use', 'title', 'desc'
]);
/** Containers whose children are kept although the container is not. */
const UNWRAP = new Set(['a', 'switch']);
/** Content that cannot be made safe by dropping it without breaking the logo. Compared lower-cased. */
const REFUSE = new Set([
	'script', 'image', 'feimage', 'iframe', 'embed', 'object', 'video', 'audio', 'canvas', 'handler', 'listener'
]);
/** Elements that draw something (a logo with none of them would be blank). */
const DRAWS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'use']);
/** Text is written only inside these. */
const TEXT_OK = new Set(['text', 'tspan', 'title', 'desc']);

/** Presentation properties: allowed as attributes and as CSS declarations. */
const PRESENTATION = new Set([
	'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'clip-rule',
	'clip-path', 'mask', 'stop-color', 'stop-opacity', 'color', 'display', 'visibility', 'font-family',
	'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing'
]);
const GEOMETRY = new Set([
	'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'dx', 'dy',
	'width', 'height', 'viewBox', 'transform', 'offset', 'gradientUnits', 'gradientTransform', 'spreadMethod',
	'clipPathUnits', 'maskUnits', 'maskContentUnits', 'preserveAspectRatio', 'version'
]);

const ID = /^[A-Za-z_][\w.-]*$/;
const CLASS = /^[\w\s-]*$/;
const FRAGMENT = /^#[A-Za-z_][\w.-]*$/;
/** Everything a presentation or geometry value needs, and nothing that starts a scheme, escape, comment or rule. */
const VALUE_CHARS = /^[\p{L}\p{N}\s#%.,()+\-_'"!/]*$/u;
const FUNCTIONS = new Set([
	'url', 'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch',
	'matrix', 'translate', 'scale', 'rotate', 'skewx', 'skewy'
]);
const URL_FRAGMENT = /^url\(\s*(['"]?)#[A-Za-z_][\w.-]*\1\s*\)$/i;

/* ------------------------------------------------------------------ *
 * Entities and values
 * ------------------------------------------------------------------ */

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Numeric references and the five XML entities; anything else stays as written. */
export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
		if (ref[0] !== '#') return NAMED[ref] ?? whole;
		const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
		return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
	});
}

/** A decoded value, or null when it is not plain presentation or geometry. */
export function safeValue(raw: string): string | null {
	const v = raw.trim();
	if (v.length > 16_384 || !VALUE_CHARS.test(v)) return null;
	// Every `(` must open a known function; `url()` only to a #fragment.
	const fn = /([A-Za-z-]*)\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = fn.exec(v))) {
		const name = m[1]!.toLowerCase();
		if (!FUNCTIONS.has(name)) return null;
		if (name === 'url') {
			const close = v.indexOf(')', m.index);
			if (close < 0 || !URL_FRAGMENT.test(v.slice(m.index, close + 1))) return null;
		}
	}
	return v;
}

/** An attribute (local name as written) and its decoded value → what to write, or null to drop it. */
function safeAttr(name: string, raw: string): [string, string] | null {
	const value = decodeEntities(raw);
	const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
	const lower = local.toLowerCase();
	if (lower === 'href' || lower === 'src') {
		const v = value.trim();
		return FRAGMENT.test(v) ? ['href', v] : null;
	}
	if (name.includes(':')) return null; // xml:space, i:extraneous, inkscape:label, xmlns:* (written by us)
	if (name === 'id') return ID.test(value.trim()) ? ['id', value.trim()] : null;
	if (name === 'class') return CLASS.test(value) ? ['class', value.trim().replace(/\s+/g, ' ')] : null;
	if (!PRESENTATION.has(name) && !GEOMETRY.has(name) && !/^stroke-[a-z]+$/.test(name)) return null;
	const v = safeValue(value);
	if (v === null) return null;
	if ((name === 'clip-path' || name === 'mask') && v !== 'none' && !URL_FRAGMENT.test(v)) return null;
	return [name, v];
}

/** CSS declarations (`fill:#abc; stroke: url('#g')`) → safe presentation attributes (values decoded by `safeAttr`). */
function declarations(css: string): [string, string][] {
	const out: [string, string][] = [];
	for (const decl of css.split(';')) {
		const colon = decl.indexOf(':');
		if (colon < 0) continue;
		const prop = decl.slice(0, colon).trim().toLowerCase();
		const value = decl.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim();
		if (!PRESENTATION.has(prop) && !/^stroke-[a-z]+$/.test(prop)) continue;
		const attr = safeAttr(prop, value);
		if (attr) out.push(attr);
	}
	return out;
}

type Rule = { classes: string[]; decls: [string, string][] };

/**
 * Simple class rules from a `<style>` sheet. Anything else is ignored: other
 * selectors, at-rules (with or without a block) and whatever a block nests.
 */
export function classRules(sheet: string): Rule[] {
	const css = sheet.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');
	const rules: Rule[] = [];
	let i = 0;
	while (i < css.length) {
		const open = css.indexOf('{', i);
		if (open < 0) break;
		// The block, to its matching brace.
		let depth = 1;
		let j = open + 1;
		for (; j < css.length && depth > 0; j++) {
			if (css[j] === '{') depth++;
			else if (css[j] === '}') depth--;
		}
		const body = css.slice(open + 1, j - 1);
		// A block-less at-rule (`@import …;`) before the selector is not part of it.
		const selector = css.slice(i, open).split(';').pop()!.trim();
		i = j;
		if (body.includes('{') || !/^\.[\w-]+(\s*,\s*\.[\w-]+)*$/.test(selector)) continue;
		const decls = declarations(body);
		if (decls.length) rules.push({ classes: selector.split(',').map((c) => c.trim().slice(1)), decls });
	}
	return rules;
}

/* ------------------------------------------------------------------ *
 * The reader
 * ------------------------------------------------------------------ */

type El = { name: string; attrs: Map<string, string>; children: Node[] };
type Node = El | string;

const NAME = /[A-Za-z_][\w.:-]*/y;
const SPACE = /\s/;

/** Past a DOCTYPE starting at `i` (at `<!DOCTYPE`), honouring quotes and the `[…]` subset. -1 when unterminated. */
function skipDoctype(s: string, i: number): number {
	let depth = 0;
	let quote = '';
	for (let j = i + 9; j < s.length; j++) {
		const c = s[j];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") quote = c;
		else if (s.startsWith('<!--', j)) {
			const end = s.indexOf('-->', j + 4);
			if (end < 0) return -1;
			j = end + 2;
		} else if (c === '[') depth++;
		else if (c === ']') depth--;
		else if (c === '>' && depth <= 0) return j + 1;
	}
	return -1;
}

/**
 * Past the prolog (BOM, whitespace, `<?…?>`, comments, DOCTYPE) from `i`: the
 * index of the first element, or -1 when the prolog is not well formed.
 */
export function skipProlog(s: string, i = 0): number {
	if (s.charCodeAt(i) === 0xfeff) i++;
	for (;;) {
		while (i < s.length && SPACE.test(s[i]!)) i++;
		if (s.startsWith('<?', i)) {
			const end = s.indexOf('?>', i + 2);
			if (end < 0) return -1;
			i = end + 2;
		} else if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4);
			if (end < 0) return -1;
			i = end + 3;
		} else if (s.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
			i = skipDoctype(s, i);
			if (i < 0) return -1;
		} else return i;
	}
}

/** The document's root element, read as a tree. Throws when it is not well formed. */
function parse(s: string): El {
	const root: El = { name: '#document', attrs: new Map(), children: [] };
	const stack: El[] = [root];
	let i = skipProlog(s);
	if (i < 0) throw unreadable();

	const top = () => stack[stack.length - 1]!;
	while (i < s.length) {
		if (s[i] !== '<') {
			const end = s.indexOf('<', i);
			const text = s.slice(i, end < 0 ? s.length : end);
			if (stack.length === 1 && text.trim()) throw unreadable();
			top().children.push(decodeEntities(text));
			i = end < 0 ? s.length : end;
			continue;
		}
		if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4);
			if (end < 0) throw unreadable();
			i = end + 3;
			continue;
		}
		if (s.startsWith('<![CDATA[', i)) {
			const end = s.indexOf(']]>', i + 9);
			if (end < 0) throw unreadable();
			// Kept (undecoded) only as a <style> sheet; elsewhere dropped.
			if (top().name === 'style') top().children.push(s.slice(i + 9, end));
			i = end + 3;
			continue;
		}
		if (s.startsWith('<?', i)) {
			const end = s.indexOf('?>', i + 2);
			if (end < 0) throw unreadable();
			i = end + 2;
			continue;
		}
		if (s.startsWith('<!', i)) {
			if (s.slice(i, i + 9).toUpperCase() !== '<!DOCTYPE') throw unreadable();
			i = skipDoctype(s, i);
			if (i < 0) throw unreadable();
			continue;
		}
		if (s[i + 1] === '/') {
			NAME.lastIndex = i + 2;
			const m = NAME.exec(s);
			if (!m) throw unreadable();
			let j = i + 2 + m[0].length;
			while (j < s.length && SPACE.test(s[j]!)) j++;
			if (s[j] !== '>' || stack.length === 1 || top().name !== m[0]) throw unreadable();
			stack.pop();
			i = j + 1;
			continue;
		}
		// A start tag.
		NAME.lastIndex = i + 1;
		const m = NAME.exec(s);
		if (!m) throw unreadable();
		const el: El = { name: m[0], attrs: new Map(), children: [] };
		let j = i + 1 + m[0].length;
		let selfClosing = false;
		for (;;) {
			const before = j;
			while (j < s.length && SPACE.test(s[j]!)) j++;
			if (s[j] === '>') {
				j++;
				break;
			}
			if (s[j] === '/' && s[j + 1] === '>') {
				selfClosing = true;
				j += 2;
				break;
			}
			if (j === before) throw unreadable(); // attributes must be separated by whitespace
			NAME.lastIndex = j;
			const a = NAME.exec(s);
			if (!a) throw unreadable();
			j += a[0].length;
			while (j < s.length && SPACE.test(s[j]!)) j++;
			if (s[j] !== '=') throw unreadable();
			j++;
			while (j < s.length && SPACE.test(s[j]!)) j++;
			const q = s[j];
			if (q !== '"' && q !== "'") throw unreadable();
			const end = s.indexOf(q, j + 1);
			if (end < 0) throw unreadable();
			const value = s.slice(j + 1, end);
			if (value.includes('<')) throw unreadable();
			if (!el.attrs.has(a[0])) el.attrs.set(a[0], value);
			j = end + 1;
		}
		if (stack.length === 1 && root.children.some((c) => typeof c !== 'string')) throw unreadable(); // a second root
		top().children.push(el);
		if (!selfClosing) {
			if (stack.length > MAX_DEPTH) throw unreadable();
			stack.push(el);
		}
		i = j;
	}
	if (stack.length !== 1) throw unreadable();
	const els = root.children.filter((c): c is El => typeof c !== 'string');
	if (els.length !== 1 || els[0]!.name !== 'svg') throw unreadable();
	return els[0]!;
}

/* ------------------------------------------------------------------ *
 * The writer
 * ------------------------------------------------------------------ */

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/** Refuses scripts and images anywhere, and gathers the `<style>` sheets. */
function survey(el: El, sheets: string[]): void {
	const local = (el.name.includes(':') ? el.name.slice(el.name.indexOf(':') + 1) : el.name).toLowerCase();
	if (REFUSE.has(local)) throw unsafe();
	if (el.name === 'style') {
		sheets.push(el.children.map((c) => (typeof c === 'string' ? c : '')).join(''));
		return;
	}
	for (const c of el.children) if (typeof c !== 'string') survey(c, sheets);
}

function write(el: El, rules: Rule[], isRoot: boolean, stats: { draws: number }): string {
	const attrs = new Map<string, string>();
	for (const [name, raw] of el.attrs) {
		const a = safeAttr(name, raw);
		if (a) attrs.set(a[0], a[1]);
	}
	const classes = new Set((attrs.get('class') ?? '').split(' ').filter(Boolean));
	for (const rule of rules) if (rule.classes.some((c) => classes.has(c))) for (const [k, v] of rule.decls) attrs.set(k, v);
	const inline = el.attrs.get('style');
	if (inline !== undefined) for (const [k, v] of declarations(inline)) attrs.set(k, v);

	if (el.name === 'use' && !attrs.has('href')) return ''; // an outside reference, dropped
	if (DRAWS.has(el.name)) stats.draws++;

	let inner = '';
	for (const c of el.children) {
		if (typeof c === 'string') {
			if (TEXT_OK.has(el.name)) inner += escapeText(c);
		} else inner += child(c, rules, stats);
	}

	let head = el.name;
	if (isRoot) {
		head += ` xmlns="${SVG_NS}"`;
		if ([...el.attrs.keys()].includes('xmlns:xlink')) head += ` xmlns:xlink="${XLINK_NS}"`;
	}
	for (const [k, v] of attrs) head += ` ${k}="${escapeAttr(v)}"`;
	return inner ? `<${head}>${inner}</${el.name}>` : `<${head}/>`;
}

function child(el: El, rules: Rule[], stats: { draws: number }): string {
	if (ELEMENTS.has(el.name)) return write(el, rules, false, stats);
	if (UNWRAP.has(el.name)) return el.children.map((c) => (typeof c === 'string' ? '' : child(c, rules, stats))).join('');
	return ''; // metadata, editor data, filters, animation, foreignObject, <style> (applied above), …
}

/**
 * The SVG rebuilt from its allowlisted parts. Throws a 400 ApiError when it is
 * not a single well-formed `<svg>` document, when it embeds scripts or images,
 * or when nothing drawable is left.
 */
export function sanitizeSvg(input: string): string {
	const root = parse(input);
	const sheets: string[] = [];
	survey(root, sheets);
	const rules = sheets.flatMap(classRules);
	const stats = { draws: 0 };
	const out = write(root, rules, true, stats);
	if (stats.draws === 0) throw new ApiError(400, 'invalid_request', 'Logo: the SVG has nothing to draw');
	return out;
}

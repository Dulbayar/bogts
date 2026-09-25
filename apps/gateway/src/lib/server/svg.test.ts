import { describe, expect, it } from 'vitest';
import { ApiError } from './api/errors';
import { classRules, decodeEntities, safeValue, sanitizeSvg, SVG_UNSAFE_MESSAGE } from './svg';
import { prepareLogo, sniffLogo } from './branding';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body: string, attrs = '') => `<svg ${NS} viewBox="0 0 10 10"${attrs}>${body}</svg>`;

/** Nothing in the output may run, load or navigate. */
function expectInert(out: string) {
	expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s>/]/);
	for (const bad of [/<script/i, /\son\w+=/i, /javascript/i, /https?:\/\/(?!www\.w3\.org\/(2000\/svg|1999\/xlink)")/i, /data:/i, /foreignObject/i, /<style/i, /<iframe/i, /<image/i, /url\((?!(['"]|&quot;)?#)/i, /&#/]) {
		expect(out, String(bad)).not.toMatch(bad);
	}
}

describe('sanitizeSvg: the adversary', () => {
	it('refuses a split script tag (<scr<style/>ipt>) as unreadable', () => {
		expect(() => sanitizeSvg(svg('<scr<style/>ipt>alert(1)</scr<style/>ipt><rect width="1" height="1"/>'))).toThrow(ApiError);
	});

	it('refuses scripts and embedded images with a clear message', () => {
		expect(() => sanitizeSvg(svg('<script>alert(1)</script><rect width="1" height="1"/>'))).toThrow(SVG_UNSAFE_MESSAGE);
		expect(() => sanitizeSvg(svg('<image href="data:image/png;base64,AAAA" width="10" height="10"/>'))).toThrow(SVG_UNSAFE_MESSAGE);
		expect(() => sanitizeSvg(svg('<g><svg:script xmlns:svg="http://www.w3.org/2000/svg">x()</svg:script></g><rect/>'))).toThrow(SVG_UNSAFE_MESSAGE);
		expect(() => sanitizeSvg(svg('<foreignObject><iframe src="https://evil.example"/></foreignObject><rect/>'))).toThrow(SVG_UNSAFE_MESSAGE);
	});

	it('drops an href under a renamed xlink prefix with an entity-hidden scheme', () => {
		const out = sanitizeSvg(svg('<use x:href="jav&#x61;script:alert(1)"/><a x:href="jav&#97;script:alert(1)"><rect width="1" height="1"/></a>', ' xmlns:x="http://www.w3.org/1999/xlink"'));
		expectInert(out);
		expect(out).not.toContain('<use');
		expect(out).toContain('<rect width="1" height="1"/>');
	});

	it('drops a style url() hidden behind an entity', () => {
		const out = sanitizeSvg(svg('<rect width="1" height="1" style="fill:u&#x72;l(https://evil.example/x.svg#p);stroke:#ff0000"/>'));
		expectInert(out);
		expect(out).toContain('stroke="#ff0000"');
		expect(out).not.toContain('fill=');
	});

	it('drops foreignObject content, event handlers and outside <use>', () => {
		const out = sanitizeSvg(
			svg(
				`<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
				<rect width="10" height="10" onload="x()" ONCLICK='y()' onmouseover="z()" fill="#0e7c7b"/>
				<use href="https://evil.example/s.svg#a"/><use xlink:href="//evil.example/s.svg#a"/><use href="#local"/>
				<circle id="local" r="2"/>`,
				' xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"'
			)
		);
		expectInert(out);
		expect(out).toContain('<rect width="10" height="10" fill="#0e7c7b"/>');
		expect(out.match(/<use/g)).toHaveLength(1);
		expect(out).toContain('<use href="#local"/>');
	});

	it('drops animation, CSS escapes, comments-in-values and unknown functions', () => {
		const out = sanitizeSvg(
			svg(`<animate attributeName="href" to="javascript:alert(1)"/><set attributeName="fill" to="red"/>
			<rect width="1" height="1" fill="u\\72l(https://evil.example)"/>
			<rect width="2" height="2" fill="expression(alert(1))"/>
			<rect width="3" height="3" fill="ur/**/l(x)"/>
			<rect width="4" height="4" fill="image-set('x.png' 1x)"/>`)
		);
		expectInert(out);
		expect(out).not.toMatch(/animate|<set|fill=/);
		expect(out.match(/<rect/g)).toHaveLength(4);
	});

	it('writes every value escaped and keeps no stray markup', () => {
		const out = sanitizeSvg(svg('<text x="1" y="5">&lt;script&gt;alert(1)&lt;/script&gt; &#60;b&#62;</text><metadata><x>&lt;script&gt;</x></metadata>'));
		expect(out).toContain('<text x="1" y="5">&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;</text>');
		expect(out).not.toContain('metadata');
	});

	it('never expands DOCTYPE entities', () => {
		const out = sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>${svg('<text>&x;</text><rect/>')}`);
		expect(out).toContain('<text>&amp;x;</text>');
		expectInert(out);
	});

	it('refuses what is not a single well-formed svg document', () => {
		for (const bad of ['<div>hi</div>', '<svg><script>', '<svg><rect></svg>', `${svg('<rect/>')}<svg/>`, 'text<svg><rect/></svg>', '<svg><rect width=1/></svg>', '<svg><!ENTITY x "y"><rect/></svg>']) {
			expect(() => sanitizeSvg(bad), bad).toThrow(ApiError);
		}
		expect(() => sanitizeSvg(svg('<g/>'))).toThrow(/nothing to draw/);
	});

	it('is stable: sanitising the output changes nothing', () => {
		const once = sanitizeSvg(svg('<style>.a{fill:url(\'#g\')}</style><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect class="a" width="1" height="1" style="stroke:#000"/>'));
		expect(sanitizeSvg(once)).toBe(once);
	});
});

describe('sanitizeSvg: real exports keep their look', () => {
	it('accepts an Illustrator "Save As" file with a DOCTYPE, entity subset and switch', async () => {
		const ai = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
	<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
	<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
	<!ENTITY ns_svg "http://www.w3.org/2000/svg">
	<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
]>
<svg version="1.1" id="Layer_1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;"
	 x="0px" y="0px" viewBox="0 0 200 60" style="enable-background:new 0 0 200 60;" xml:space="preserve">
<style type="text/css">
	.st0{fill:#E30613;}
	.st1{fill:none;stroke:#1D1D1B;stroke-width:2;stroke-miterlimit:10;}
</style>
<switch>
	<foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1">
		<i:pgfRef xlink:href="#adobe_illustrator_pgf"></i:pgfRef>
	</foreignObject>
	<g i:extraneous="self">
		<path class="st0" d="M10,10h40v40H10V10z"/>
		<circle class="st1" cx="100" cy="30" r="20"/>
	</g>
</switch>
<i:pgf id="adobe_illustrator_pgf"><![CDATA[eJzs vQtwJFd...]]></i:pgf>
</svg>`;
		const bytes = new TextEncoder().encode(ai);
		expect(sniffLogo(bytes)).toBe('image/svg+xml');
		const out = sanitizeSvg(ai);
		expectInert(out);
		expect(out).toContain('<path class="st0" d="M10,10h40v40H10V10z" fill="#E30613"/>');
		expect(out).toContain('<circle class="st1" cx="100" cy="30" r="20" fill="none" stroke="#1D1D1B" stroke-width="2" stroke-miterlimit="10"/>');
		expect(out).not.toMatch(/pgf|foreignObject|enable-background|xml:space|ns_/);
		expect((await prepareLogo(new File([bytes], 'logo.svg'))).type).toBe('image/svg+xml');
	});

	it('turns <style> class colours (CDATA or not) and quoted gradient refs into attributes', () => {
		const out = sanitizeSvg(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
<defs>
	<style><![CDATA[ /* brand */ .cls-1{fill:url('#grad-a');} .cls-2, .cls-3 { fill: url("#grad-b") ; stroke:#123abc !important } @import url(https://evil.example/x.css); .cls-4 > path{fill:red} ]]></style>
	<style>.cls-3{stroke:#fedcba}</style>
	<linearGradient id="grad-a" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0e7c7b"/><stop offset="1" stop-color="#ffd400" stop-opacity=".8"/></linearGradient>
	<radialGradient id="grad-b" xlink:href="#grad-a" cx="50" cy="50" r="50"/>
</defs>
<rect class="cls-1" width="100" height="50"/>
<circle class="cls-2" cx="50" cy="75" r="20" fill="#000"/>
<ellipse class="cls-3" cx="50" cy="75" rx="5" ry="4" style="stroke:#000000"/>
</svg>`);
		expectInert(out);
		expect(out).toContain(`<rect class="cls-1" width="100" height="50" fill="url('#grad-a')"/>`);
		expect(out).toContain(`<circle class="cls-2" cx="50" cy="75" r="20" fill="url(&quot;#grad-b&quot;)" stroke="#123abc"/>`);
		// Later rule over earlier, inline style over both.
		expect(out).toContain(`<ellipse class="cls-3" cx="50" cy="75" rx="5" ry="4" fill="url(&quot;#grad-b&quot;)" stroke="#000000"/>`);
		expect(out).toContain('<radialGradient id="grad-b" href="#grad-a" cx="50" cy="50" r="50"/>');
		expect(out).toContain('<stop offset="1" stop-color="#ffd400" stop-opacity=".8"/>');
		expect(out).not.toContain('red');
	});

	it('keeps clip paths, masks, transforms and text', () => {
		const out = sanitizeSvg(
			svg(
				'<defs><clipPath id="c"><rect width="5" height="5"/></clipPath><mask id="m"><rect width="10" height="10" fill="#fff"/></mask></defs>' +
					'<g clip-path="url(#c)" mask="url(#m)" transform="translate(1 2) rotate(45)" opacity="0.5"><polygon points="0,0 5,0 5,5" fill-rule="evenodd"/></g>' +
					'<text x="1" y="9" font-family="\'Geologica\', sans-serif" font-size="4">Богц <tspan fill="rgb(0 0 0 / 50%)">pay</tspan></text>'
			)
		);
		expect(out).toContain('<g clip-path="url(#c)" mask="url(#m)" transform="translate(1 2) rotate(45)" opacity="0.5">');
		expect(out).toContain('<text x="1" y="9" font-family="\'Geologica\', sans-serif" font-size="4">Богц <tspan fill="rgb(0 0 0 / 50%)">pay</tspan></text>');
		expect(sanitizeSvg(svg('<rect width="1" height="1" clip-path="url(#c) x"/>'))).not.toContain('clip-path');
	});
});

describe('svg helpers', () => {
	it('decodes numeric and XML entities only', () => {
		expect(decodeEntities('jav&#x61;&#115;cript&colon;&amp;&#0;')).toBe('javascript&colon;&�');
	});
	it('accepts plain values and refuses schemes, escapes and outside urls', () => {
		expect(safeValue(' #0e7c7b ')).toBe('#0e7c7b');
		expect(safeValue("url('#a')")).toBe("url('#a')");
		for (const bad of ['javascript:x', 'url(x.svg#a)', 'url(#a', 'u\\rl(x)', 'expression(1)', 'a;b', 'a@b', 'a<b']) expect(safeValue(bad), bad).toBeNull();
	});
	it('reads only simple class rules', () => {
		expect(classRules('.a{fill:#fff} svg .b{fill:red} .c:hover{fill:red} @media x{.d{fill:red}}')).toEqual([{ classes: ['a'], decls: [['fill', '#fff']] }]);
	});
});

/**
 * CSS color → Monaco theme color.
 *
 * Monaco's theme registry accepts `#RRGGBB` or `#RRGGBBAA`. Webview theme
 * variables arrive as hex or `rgb()/rgba()`, and diff fills rely on their alpha;
 * dropping it turns a subtle comparison tint into an opaque block.
 */

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB =
	/^rgba?\(\s*([0-9]{1,3})(?:\s*,\s*|\s+)([0-9]{1,3})(?:\s*,\s*|\s+)([0-9]{1,3})(?:\s*[,/]\s*|\s+)?([0-9.]+%?)?\s*\)$/i;

function channel(value: string): number {
	return Math.max(0, Math.min(255, Number(value)));
}

function parseAlpha(value: string): number {
	return value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
}

/** A channel Monaco can use: finite and not fully opaque. */
function isVisibleAlpha(alpha: number): boolean {
	return Number.isFinite(alpha) && alpha < 1;
}

function toAlphaHex(alpha: number): string {
	return Math.round(Math.max(0, alpha) * 255)
		.toString(16)
		.padStart(2, '0');
}

function alphaChannel(value: string | undefined): string {
	if (value === undefined) {
		return '';
	}
	if (value === '') {
		return '';
	}
	const alpha = parseAlpha(value);
	if (!isVisibleAlpha(alpha)) {
		return '';
	}
	return toAlphaHex(alpha);
}

/** Expand shorthand hex so Monaco always receives six or eight digits. */
function expandHex(digits: string): string {
	const lower = digits.toLowerCase();
	if (lower.length === 3 || lower.length === 4) {
		return `#${lower
			.split('')
			.map((part) => part + part)
			.join('')}`;
	}
	return `#${lower}`;
}

export function toMonacoColor(value: string, fallback: string): string {
	const text = value.trim();
	const hex = HEX.exec(text);
	if (hex !== null) {
		return expandHex(hex[1]);
	}
	const rgb = RGB.exec(text);
	if (rgb === null) {
		return fallback;
	}
	const alpha = alphaChannel(rgb[4]);
	const part = (raw: string): string => channel(raw).toString(16).padStart(2, '0');
	return `#${part(rgb[1])}${part(rgb[2])}${part(rgb[3])}${alpha}`;
}

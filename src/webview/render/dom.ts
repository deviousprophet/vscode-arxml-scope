/**
 * Small DOM factory helpers shared by the two page composition roots and the
 * Details editor. Every helper sets text with `textContent`: model text is never
 * inserted as markup.
 */

/** One element with an optional class and text. */
export function inspectorElement(tag: string, className?: string, text?: string): HTMLElement {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

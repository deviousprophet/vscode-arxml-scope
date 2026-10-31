/**
 * Shared page styles: tokens first, then the reset/layout boxes. Components
 * import their own CSS; a composition root concatenates both in this order.
 */
import tokens from './tokens.css';
import base from './base.css';

export function sharedStyles(): string {
	return `${tokens}${base}`;
}

export function tokensStyles(): string {
	return tokens;
}

export function baseStyles(): string {
	return base;
}

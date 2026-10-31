/**
 * esbuild loads `.css` files as text (`loader: { '.css': 'text' }`). Component
 * modules import their stylesheet and the composition root injects the string
 * into the page's nonce stylesheet; the files stay colocated with their owner.
 */
declare module '*.css' {
	const text: string;
	export default text;
}

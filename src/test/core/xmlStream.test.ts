import * as assert from 'assert';

import { XmlStreamParser } from '../../core/index/xmlStream';

interface Event {
	kind: 'open' | 'close' | 'text';
	name?: string;
	text?: string;
	start: number;
	end: number;
	attrs?: Record<string, string>;
}

function collect(chunks: readonly string[]): Event[] {
	const events: Event[] = [];
	const parser = new XmlStreamParser({
		open: (name, attrs, offset) => {
			events.push({ kind: 'open', name, start: offset, end: offset, attrs: Object.fromEntries(attrs) });
		},
		close: (name, offset) => {
			events.push({ kind: 'close', name, start: offset, end: offset });
		},
		text: (text, start, end) => {
			events.push({ kind: 'text', text, start, end });
		},
	});
	for (const chunk of chunks) {
		parser.write(chunk);
	}
	parser.end();
	return events;
}

const SAMPLE = `<?xml version="1.0"?>
<!-- a comment with <angle> -->
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_00048.xsd">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>P</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>M</SHORT-NAME>
          <DESC><![CDATA[a < cdata > block]]></DESC>
          <EMPTY/>
          <TEXT>hello &amp; goodbye</TEXT>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

suite('xmlStream (core)', () => {
	test('whole-buffer and chunked parses produce identical events', () => {
		const whole = collect([SAMPLE]);
		for (const size of [1, 2, 3, 7, 13]) {
			const chunks: string[] = [];
			for (let at = 0; at < SAMPLE.length; at += size) {
				chunks.push(SAMPLE.slice(at, at + size));
			}
			assert.deepStrictEqual(collect(chunks), whole, `chunk size ${size}`);
		}
	});

	test('offsets point at the real construct in the source', () => {
		const events = collect([SAMPLE]);
		const open = events.find((event) => event.kind === 'open' && event.name === 'SHORT-NAME');
		assert.ok(open);
		assert.strictEqual(SAMPLE.slice(open.start, open.start + '<SHORT-NAME>'.length), '<SHORT-NAME>');
		const text = events.find(
			(event) => event.kind === 'text' && event.text === 'P' && SAMPLE.slice(event.start, event.end) === 'P'
		);
		assert.ok(text, 'the SHORT-NAME text carries its own absolute range');
	});

	test('handles quoted > in attributes, comments, CDATA, PI and DOCTYPE', () => {
		const events = collect([
			'<!DOCTYPE AUTOSAR [<!ENTITY x "y">]><AUTOSAR a="1 > 0">',
			'<!-- ignored <tag> --><![CDATA[<raw>]]><T>text</T><?pi data?></AUTOSAR>',
		]);
		const names = events.filter((event) => event.kind !== 'text').map((event) => `${event.kind}:${event.name}`);
		assert.deepStrictEqual(names, ['open:AUTOSAR', 'open:T', 'close:T', 'close:AUTOSAR']);
		const texts = events.filter((event) => event.kind === 'text').map((event) => event.text);
		assert.deepStrictEqual(texts, ['<raw>', 'text']);
		const autosar = events[0];
		assert.deepStrictEqual(autosar.attrs, { a: '1 > 0' });
	});

	test('a self-closing tag emits open then close at the same offset', () => {
		const events = collect(['<A><B x="1"/><C></C></A>']);
		assert.deepStrictEqual(
			events.map((event) => `${event.kind}:${event.name}`),
			['open:A', 'open:B', 'close:B', 'open:C', 'close:C', 'close:A']
		);
		const open = events[1];
		const close = events[2];
		assert.strictEqual(close.start, open.start + '<B x="1"/>'.length);
	});

	test('an unterminated construct at end-of-stream is dropped, not emitted as text', () => {
		const events = collect(['<A>ok<T attr="unfinished']);
		assert.deepStrictEqual(
			events.map((event) => `${event.kind}:${event.name ?? event.text}`),
			['open:A', 'text:ok']
		);
	});
});

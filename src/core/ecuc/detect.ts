/**
 * ECUC-Values detection (parent design §5, R2).
 *
 * The `.arxml` path check runs first: a file that is not `.arxml` is rejected
 * before its content is consulted. The content test is namespace-tolerant and
 * accepts any prefix, so `ns:ECUC-MODULE-CONFIGURATION-VALUES` is recognised.
 *
 * No file I/O: the caller supplies both the path and the text.
 */

const ECUC_VALUES = /<(?:[\w.-]+:)?ECUC-MODULE-CONFIGURATION-VALUES(?=[\s/>])/i;

/** True when `filePath` is an `.arxml` file. */
export function isArxmlPath(filePath: string): boolean {
	return /\.arxml$/i.test(filePath);
}

/**
 * True when the file is an `.arxml` path whose text contains an ECUC-Values
 * module configuration element.
 */
export function isEcucValues(text: string, filePath: string): boolean {
	if (!isArxmlPath(filePath)) {
		return false;
	}
	return ECUC_VALUES.test(text);
}

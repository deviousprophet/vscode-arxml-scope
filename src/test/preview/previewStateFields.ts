/**
 * The optional scenario switches shared by the preview server state and the
 * browser payload. One declaration keeps the two protocol halves in sync.
 */
import type { MonacoSettings } from '../../webviewProtocol';

export interface PreviewStateFields {
	/** The curated editor settings the diff page inherits, when the state posts them. */
	settings?: MonacoSettings;
	merge?: boolean;
	swap?: boolean;
	/** Long parameter names force horizontal overflow; the copy arrows must survive it. */
	wide?: boolean;
	/** Horizontal scroll offset applied after the page renders. */
	pan?: number;
	/** F7 presses after mounting; the long document's first change is near line 1000. */
	jump?: number;
	select?: boolean;
	/** Opens the native find widget and seeds this query, with Rust-shaped results. */
	find?: string;
	/** Types this text into the first parameter to exercise the local dirty state. */
	edit?: string;
	/** Types this text into the Details value control of a textual parameter. */
	detailsEdit?: string;
	/** Presses Ctrl+S after the Details typing and answers the edit acknowledgements. */
	detailsSave?: boolean;
	/** Runs one local undo after the Details typing. */
	detailsUndo?: boolean;
	/** Runs one local redo after that undo. */
	detailsRedo?: boolean;
	/** Runs the direct-editor delete/word-delete/replace typing scenario. */
	deleteEdit?: boolean;
	/** Renames the selected container, then types again before the re-scan echo. */
	detailsRename?: boolean;
	/** With `detailsRename`, refuses the post-flush rename edit after the re-scan. */
	renameRefusal?: boolean;
	/** With `detailsRename`, delivers the re-scan before the rename acknowledgement. */
	renameLateAck?: boolean;
	/** Edits the textual and decimal values, then Ctrl+S with both acknowledgements. */
	multiSave?: boolean;
	/** Pastes text containing a newline into the textual value span. */
	pasteEdit?: boolean;
	/** Types a draft, removes its row from the re-scan, then attempts Ctrl+S. */
	staleSave?: boolean;
	/** Scrolls the editor to this 1-based line and waits for sticky scope. */
	scrollLine?: number;
	/** Attempts Ctrl+S after the edit, exercising the save guard. */
	trySave?: boolean;
}

/**
 * The optional scenario switches shared by the preview server state and the
 * browser payload. One declaration keeps the two protocol halves in sync.
 */
export interface PreviewStateFields {
	merge?: boolean;
	swap?: boolean;
	/** Long parameter names force horizontal overflow; native scrolling must stay inside the pane. */
	wide?: boolean;
	/** Horizontal scroll offset applied after the page renders. */
	pan?: number;
	/** Next-diff clicks after mounting; the long document's first change is near line 1000. */
	jump?: number;
	/** Records the Next/Prev sequence and the sequence after Swap for the navigation audit. */
	nav?: boolean;
	/** Folds the diff row whose text contains this label and records the visible result. */
	foldLabel?: string;
	/** Clicks the diff Collapse All action and records both panes' visible rows. */
	collapseAll?: boolean;
	select?: boolean;
	/** Exercises the built-in sash drag, ratio persistence and double-click reset. */
	sash?: boolean;
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
	/** Scrolls the diff modified pane to this 1-based line and waits for the sticky header. */
	diffScrollLine?: number;
	/** Attempts Ctrl+S after the edit, exercising the save guard. */
	trySave?: boolean;
	/** Posts copied-but-unsaved rows so the page paints the modified-line markers. */
	copied?: boolean;
}

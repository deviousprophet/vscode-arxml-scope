const vscode = acquireVsCodeApi();

function apply(state) {
	document.body.className = '';
	for (const name of state.classes ?? []) {
		document.body.classList.add(name);
	}
	const content = document.getElementById('content');
	if (state.text) {
		content.textContent = state.text;
	}
	if (state.consoleError) {
		console.error(state.consoleError);
	}
	window.__toyState = state.name;
	document.body.dataset.previewReady = 'true';
	vscode.postMessage({ type: 'toy-rendered', state: state.name });
}

window.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'toy-state') {
		apply(event.data.state);
	}
});

apply({ name: 'initial', classes: [], text: 'Toy webview ready.' });

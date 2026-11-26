const vscode = acquireVsCodeApi();

function applyClasses(body, names) {
	body.className = '';
	for (const name of names ?? []) {
		body.classList.add(name);
	}
}

function apply(state) {
	applyClasses(document.body, state.classes);
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

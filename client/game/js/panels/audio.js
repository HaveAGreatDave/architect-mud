// Thin glue between the game client and the shared window.AudioEngine
// (client/shared/audio-engine.js, loaded as a plain global script before
// this ESM module). Decisions about *what* plays come from the server via
// WS messages handled in dispatch.js. Volume settings are applied directly
// by client/shared/settings.js's applySettings(); this module only handles
// the one-time AudioContext unlock (browsers block autoplay until a user
// gesture) and generic local UI click feedback.

// Local-only — pure UI feedback for clicking a button, not gameplay state,
// so (unlike the server-driven SFX from plugins/audio/) it never needs a
// round-trip. Same treatment as the TV hum/static loops in panels/tv.js.
const UI_CLICK_DEF = {
	id: 'ui_click_local', category: 'sfx', priority: 2,
	config: { waveform: 'square', freq: 880, duration: 0.05, gain: 0.5,
		adsr: { a: 0.001, d: 0.04, s: 0, r: 0.02 } },
};

let _initialized = false;

export function initAudio() {
	if (_initialized) return;
	_initialized = true;

	const resume = () => window.AudioEngine?.init();
	window.addEventListener('pointerdown', resume, { once: true });
	window.addEventListener('keydown', resume, { once: true });

	document.addEventListener('click', (e) => {
		if (e.target.closest('button, .action-btn, .settings-opt')) {
			window.AudioEngine?.playSfx(UI_CLICK_DEF);
		}
	});
}

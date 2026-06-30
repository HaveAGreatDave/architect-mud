// Thin glue between the game client and the shared window.AudioEngine
// (client/shared/audio-engine.js, loaded as a plain global script before
// this ESM module). Decisions about *what* plays come from the server via
// WS messages handled in dispatch.js. Volume settings are applied directly
// by client/shared/settings.js's applySettings(); this module only handles
// the one-time AudioContext unlock (browsers block autoplay until a user
// gesture).

let _initialized = false;

export function initAudio() {
	if (_initialized) return;
	_initialized = true;

	const resume = () => window.AudioEngine?.init();
	window.addEventListener('pointerdown', resume, { once: true });
	window.addEventListener('keydown', resume, { once: true });
}

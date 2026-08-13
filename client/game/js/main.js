import { command as textBreachCommand } from './panels/textbreach.js';
import { command as textHololockCommand } from './panels/texthololock.js';
import { command as textVaultCommand } from './panels/textvault.js';
import { command as textSignalCommand } from './panels/textsignal.js';
import { command as textFishingCommand } from './panels/textfishing.js';
import { command as textNullCommand } from './panels/textnullboard.js';
import { command as textCalibrationCommand } from './panels/textcalibration.js';
import {
	loadSettings,
	saveSettings,
	applySettings,
	initSettingsUI,
	initThemeEditorOverlay,
	listenForSettingsChanges,
	SETTINGS_KEY,
} from "/shared/settings.js";
import { appendMsg, initVitalsReorder } from "./render.js";
import {
	initNet,
	setWhoModalHandler,
	setMinigameCommandHandler,
	sendCmd,
	doAuth,
	doForgotPassword,
	doResetPassword,
	doResendVerification,
	showVerifyScreen,
	closeConnection,
	sendRaw,
	restoreDisplayRungPref,
	watchDisplayRungChoice,
} from "./net.js";
import { handleServerMsg } from "./dispatch.js";
import { state } from "./state.js";
import { initInput, handleClientCommand } from "./input.js";
import { initA11yFocus } from "./a11y-focus.js";
import { initDictation, setDictationMode } from "./dictation.js";
import { initLogReader, setLogReaderMode, setLogReaderRate } from "./logreader.js";
import { initTradePanel } from "./panels/trade.js";
import { initRecipesPanel } from "./panels/recipes.js";
import { initStatsPanel } from "./panels/stats.js";
import { initSkillsPanel } from "./panels/skills.js";
import { initContainerPanel } from "./panels/container.js";
import { initWardrobePanel } from "./panels/wardrobe.js";
import { initWorkspacePanel } from "./panels/workspace.js";
import { initLootPanel } from "./panels/loot.js";
import { initDialogue } from "./panels/dialogue.js";
import { initForecast } from "./panels/forecast.js";
import { initWhisperPanel, debugFakeWhisper } from "./panels/whisper.js";
import { initWho, openWhoModal } from "./panels/who.js";
import { initPlayersPanel } from "./panels/players.js";
import { showAmountDialog, showDangerDialog } from "./panels/confirm.js";
import { initSidebarOrder } from "./panels/sidebar-order.js";
import { mountCustomPanels } from "./panels/custom/manager.js";
import { initCustomPanelButton } from "./panels/custom/builder.js";
import { refreshTempDisplay } from "./panels/environment.js";
import { initWeatherFx, setWeatherFxEnabled } from "./panels/weather-fx.js";
import { setMapOverlay, setMinimapRender } from "./panels/minimap.js";
import { initAtmPanel } from "./panels/atm.js";
import { initInsurancePanel } from "./panels/insurance.js";
import { initWantedHud } from "./panels/wanted.js";
import { setDistrictLegend } from "./panels/minimap.js";
import { initTvPanel } from "./panels/tv.js";
import { initMediaDeckPanel } from "./panels/mediadeck.js";
import { initAudio } from "./panels/audio.js";
import { initMusicPlayerPanel, stopMusicPlayer } from "./panels/musicplayer.js";
import { stopEngineAudio } from "./panels/engine-audio.js";
import { isFlightSimActive } from "./panels/cockpit.js";
import { isHangarBayWalkActive } from "./panels/hangar-bay.js";
import { isTruckDepotWalkActive } from "./panels/truck-depot.js";

// Settings
const settings = loadSettings();
// Touch device, at ANY width — a phone, a tablet, a handset held sideways. This
// half of the test never changes after load.
const _isTouch =
	/Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
	(globalThis.matchMedia?.("(pointer: coarse)")?.matches ?? false);
const _isMobile = () => _isTouch || window.innerWidth < 720;
if (!localStorage.getItem(SETTINGS_KEY) && _isMobile()) {
	settings.fontSize = "19";
}
// Display density (desktop/mobile layout) is not a player setting — it's fixed
// to the device, full stop. It is also THE authority for the phone chrome: the
// stylesheet's chrome rules key off html[data-density="compact"] rather than a
// viewport query, precisely so a touch device wider than 720px gets all of it
// instead of half. Recomputed on resize/orientationchange because a window
// dragged past 720px, or a phone rotated, has genuinely changed device class —
// computing it once at load left the flag lying for the rest of the session.
settings.density = _isMobile() ? "compact" : "comfortable";
// Smart UI (the contextual per-room action bar, panels/smartbar.js) is always on
// now, every device — applySettings pins data-smart-ui="on" — so there's no
// per-player default to seed here anymore.

// In compact mode, override --font-size-base to fit the actual viewport rather than
// using the stored fontSize value (which was picked for a different screen size).
function applyMobileScale() {
	if (settings.density !== "compact") return;
	// An explicit Font Size pick wins over the auto-fit. The fit exists because a
	// size chosen on a desktop is meaningless on a handset; it is not a reason to
	// refuse a size chosen ON the handset.
	if (settings.fontSizeChosen) {
		document.documentElement.style.setProperty(
			"--font-size-base",
			(settings.fontSize || "16") + "px",
		);
		return;
	}
	// ~28px of content per character column fits comfortably; clamp between 12–18px.
	// The floor used to be 10. It was safe when --font-size-base only drove the log
	// and the chrome stayed at its hardcoded px sizes; now it is the ROOT font size,
	// so a 10px root would take a 9px label down to 5.6px. 12 is the narrowest root
	// the rest of the scale still reads at, and it only binds below ~340px wide.
	const byWidth = Math.floor(window.innerWidth / 28);
	const sz = Math.max(12, Math.min(18, byWidth));
	document.documentElement.style.setProperty("--font-size-base", sz + "px");
}

// Weather FX overlay — register the Settings apply hook before the first
// applySettings() so its initial enable/disable is honoured, then start it.
initWeatherFx();
window._applyWeatherFx = setWeatherFxEnabled;
// Minimap tile-overlay mode (Settings → Layout → Map Labels). Same deal: hook
// registered before the first applySettings() so the saved mode is honoured.
window._applyMapOverlay = setMapOverlay;
// Which renderer draws the minimap (Settings → Layout → Minimap). Same deal again.
window._applyMinimapRender = setMinimapRender;
// Voice input (Settings → Accessibility → Voice Input). Same deal once more —
// registered before the first applySettings() so a player who turned it on last
// session has the mic button on this one.
window._applyDictation = setDictationMode;
// Read Aloud (Settings → Accessibility → Read Aloud). Off by default; see the
// screen-reader note at the top of logreader.js.
window._applyLogVoice = setLogReaderMode;
window._applyLogVoiceRate = setLogReaderRate;

applySettings(settings);
// Mobile vs. desktop layout is auto-detected per device at launch — there is no
// user toggle for that (data-density above). The Smart bar (#smart-bar,
// data-smart-ui) is always on, every device — applySettings pins it.
applyMobileScale();

// Keep the density flag honest as the window changes shape. Only re-applies when
// the class actually flips, so an ordinary resize doesn't churn the whole
// stylesheet — and applySettings is what writes data-density, so this is the one
// call that has to happen.
function syncDensity() {
	const want = _isMobile() ? "compact" : "comfortable";
	if (settings.density !== want) {
		settings.density = want;
		applySettings(settings);
		if (want === "compact") setupMobilePane();
	}
	applyMobileScale();
}
window.addEventListener("resize", syncDensity);
window.addEventListener("orientationchange", syncDensity);

// Load any dev-panel overrides for the interface/game SFX catalog (the poker
// table + the hacking/lock minigames) so tuned cues take effect. Fire-and-forget;
// if it fails the built-in defaults from /shared/sfx-catalog.js stand.
fetch("/api/audio/interface-sfx")
	.then((r) => (r.ok ? r.json() : []))
	.then((rows) => {
		const list = Array.isArray(rows) ? rows : [];
		window.SFXCatalog?.applyOverrides(list);
		// The procedural tables ride the same override rows under reserved ids,
		// so tuning a material in the dev panel reaches the live generators.
		window.ProceduralSFX?.applyOverrides(list);
	})
	.catch(() => {});

// The district legend (regional-map tint, legend swatches, tile tooltip) comes off
// the server's own district rows. It used to be a hardcoded table in minimap.js
// that someone had to remember to extend, and four districts were missed — the
// Wilds among them, 3,471 tiles with no colour on the map. Same fire-and-forget
// shape as the SFX catalog above: the map renders without it (tiles fall back to
// terrain, which is what colours most of them anyway) and re-renders once it lands.
fetch("/api/districts")
	.then((r) => (r.ok ? r.json() : null))
	.then((d) => d?.districts && setDistrictLegend(d.districts))
	.catch(() => {});

// Mobile area-pane: always starts collapsed. The resize-handle bar is always
// visible and hosts the toggle button (▼/▲). No auto-open on content update.
//
// Wired once, the first time the layout is compact — at load for a phone, or on
// the resize that flips a desktop window into the compact class (syncDensity
// calls this). Without that second entry point the handle would appear with the
// chrome but do nothing until a refresh.
let _mobilePaneWired = false;
function setupMobilePane() {
	if (_mobilePaneWired) return;
	_mobilePaneWired = true;
	const _areaPane = document.getElementById("area-pane");
	const _toggleBar = document.getElementById("area-toggle-bar");
	const _toggleBtn = document.getElementById("area-pane-toggle");

	const _resizeHandle = document.getElementById("look-resize-handle");

	function _setAreaPane(open) {
		_areaPane.classList.toggle("mob-pane-hidden", !open);
		if (open) {
			// Reset to auto-fit so a stale saved height doesn't keep pane at 0
			_areaPane.style.height = "";
			_areaPane.style.maxHeight = "";
			_resizeHandle?.classList.remove("manual");
			localStorage.removeItem("lookPaneHeight");
		}
		if (_toggleBtn) _toggleBtn.textContent = open ? "▲" : "▼";
	}

	// Hide the old toggle bar — the handle button replaces it
	if (_toggleBar) _toggleBar.style.display = "none";

	// Start collapsed
	_setAreaPane(false);

	// Clicking anywhere on the handle bar toggles the pane.
	// Guard: ignore if the touch/click was part of a drag (moved more than 4px).
	let _handleDragged = false;
	_resizeHandle?.addEventListener("touchstart", () => { _handleDragged = false; }, { passive: true });
	_resizeHandle?.addEventListener("touchmove",  () => { _handleDragged = true;  }, { passive: true });
	_resizeHandle?.addEventListener("click", () => {
		if (_handleDragged) return;
		_setAreaPane(_areaPane.classList.contains("mob-pane-hidden"));
	});

	// When the soft keyboard appears, shrink the body to the visual viewport
	// height so the bottom bar (dpad/cmds/input) stays pinned just above the
	// keyboard and #output (flex:1) fills whatever space remains.
	if (window.visualViewport) {
		const _output = document.getElementById("output");
		let _fullVH = window.visualViewport.height;
		let _paneWasOpen = false;

		window.visualViewport.addEventListener("resize", () => {
			const vh = window.visualViewport.height;
			const keyboardUp = vh < _fullVH * 0.75;
			if (keyboardUp) {
				document.body.style.height = vh + "px";
				window.scrollTo(0, window.visualViewport.offsetTop);
				_paneWasOpen = !_areaPane.classList.contains("mob-pane-hidden");
				_setAreaPane(false);
			} else {
				_fullVH = vh;
				document.body.style.height = "";
				if (_paneWasOpen) _setAreaPane(true);
				_output.scrollTop = _output.scrollHeight;
			}
		});
	}
}
if (_isMobile()) setupMobilePane();

listenForSettingsChanges((s) => {
	applySettings(s);
	applyMobileScale();
});
initAudio();

async function saveOrigin(text) {
	const token = sessionStorage.getItem("devpanel-token");
	const res = await fetch("/api/players/me/profile", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ origin_fragment: text }),
	})
		.then((r) => r.json())
		.catch(() => ({ error: "Request failed" }));
	if (res.error) {
		appendMsg(res.error, "error");
		return false;
	}
	if (state.player)
		state.player.origin_fragment = text;
	return true;
}

// saveAndApply is called after settings.js mutates the settings object in-place
initSettingsUI(
	settings,
	() => {
		saveSettings(settings);
		applySettings(settings);
		applyMobileScale();
		refreshTempDisplay();
	},
	{
		sendCmd,
		notify: (msg) => appendMsg(msg, "system"),
	},
);

// Bridge for the hidden sound toggle in index.html (lives in the same
// secret-reveal panel as the MIS toggle) — it's plain inline markup, not a
// module, so it can't import settings.js directly.
window._setAudioEnabled = (enabled) => {
	if (!settings.audio) settings.audio = {};
	settings.audio.enabled = enabled;
	saveSettings(settings);
	applySettings(settings);
};

initThemeEditorOverlay();
mountCustomPanels(); // inject custom sections before the layout engine lays out
initSidebarOrder();
initVitalsReorder();
initCustomPanelButton();

// Net / WebSocket
initNet(handleServerMsg);
setWhoModalHandler(openWhoModal);
// The character breach board claims ping/scan/breach/abort while it is open — a
// text minigame runs entirely client-side, so there is nothing server-side to
// receive those words. Returns false when the board is shut, so the verbs stay
// available to whatever else owns them.
setMinigameCommandHandler((cmd) => textBreachCommand(cmd) || textHololockCommand(cmd) || textVaultCommand(cmd) || textSignalCommand(cmd) || textFishingCommand(cmd) || textCalibrationCommand(cmd) || textNullCommand(cmd));

// Auth form — restore remembered credentials
const _savedUser = localStorage.getItem("mud_remember_user");
const _savedPass = localStorage.getItem("mud_remember_pass");
if (_savedUser && _savedPass) {
	document.getElementById("auth-username").value = _savedUser;
	document.getElementById("auth-password").value = _savedPass;
	document.getElementById("auth-remember").checked = true;
	// Auto-login is in flight (see net.js onOpen) — hide the form to avoid a flash
	document.getElementById("auth-screen").style.display = "none";
}

// Re-check the Display Mode radio this machine last used, and open the
// disclosure if there was one. Runs before any auto-login hides the screen,
// which is fine — nothing here sends anything.
restoreDisplayRungPref();
// ...and watch for the player actually pressing one, which is a different thing
// from the radio being checked: a restored choice only seeds an account that has
// none, a pressed one overrides whatever the account already had.
watchDisplayRungChoice();

document.getElementById("auth-submit").addEventListener("click", doAuth);
document.getElementById("auth-password").addEventListener("keydown", (e) => {
	if (e.key === "Enter") doAuth();
});
document.getElementById("auth-username").addEventListener("keydown", (e) => {
	if (e.key === "Enter") doAuth();
});
document.getElementById("auth-handle").addEventListener("keydown", (e) => {
	if (e.key === "Enter") doAuth();
});

// A locked door is said on the page, not discovered after typing a whole form
// in. Login is untouched — this only removes the way IN to registration.
fetch("/api/registrations/status")
	.then((r) => r.json())
	.then((data) => {
		if (!data || data.open !== false) return;
		const notice = document.getElementById("auth-registrations-closed");
		const wrap = document.getElementById("auth-toggle-wrap");
		if (!notice || !wrap) return;
		notice.textContent = data.message || "";
		notice.style.display = "";
		wrap.style.display = "none";
		if (state.isRegister) document.getElementById("auth-toggle-link").click();
	})
	.catch(() => {});

document.getElementById("auth-toggle-link").addEventListener("click", (e) => {
	state.isRegister = !state.isRegister;
	document
		.getElementById("handle-field")
		.classList.toggle("visible", state.isRegister);
	// biological sex & sexuality now live in the chargen section, not registration
	document.getElementById("email-field").style.display = state.isRegister
		? ""
		: "none";
	document.getElementById("forgot-link-wrap").style.display = state.isRegister
		? "none"
		: "";
	document.getElementById("auth-toggle-text").textContent = state.isRegister
		? "Have an account?"
		: "No account?";
	document.getElementById("auth-toggle-link").textContent = state.isRegister
		? "Login"
		: "Register";
	document.getElementById("auth-submit").textContent = state.isRegister
		? "Register"
		: "Enter";
	// A password manager should OFFER TO GENERATE on the register form and offer
	// to fill on the login form, and it decides which off this attribute alone.
	// It was hardcoded to current-password, so registering prompted for an
	// existing password that by definition does not exist yet — worst for exactly
	// the players who lean hardest on a manager, since a generated password is
	// the least dictatable string on the screen.
	document.getElementById("auth-password").autocomplete = state.isRegister
		? "new-password"
		: "current-password";
	// Say what just changed, then land focus on the first field that appeared.
	// The reveal is silent otherwise: two required fields materialise ABOVE the
	// toggle, and the first anyone hears of the handle is the form rejecting them
	// for leaving it blank.
	//
	// GATED ON isTrusted. The registrations-closed check above flips this toggle
	// with a synthetic .click() when a fetch resolves — seconds after load, with
	// no gesture behind it. Announcing and grabbing focus there would yank the
	// caret out of whatever the player had already started typing. A synthetic
	// click reports isTrusted false, so only a real press moves anything.
	if (!e.isTrusted) return;
	const status = document.getElementById("auth-mode-status");
	if (status)
		status.textContent = state.isRegister
			? "Register mode. Handle and email fields added above."
			: "Login mode. Handle and email fields removed.";
	if (state.isRegister) document.getElementById("auth-handle").focus();
	else document.getElementById("auth-username").focus();
});

function _makeDraggable(window, handle) {
	let ox = 0,
		oy = 0;
	handle.addEventListener("pointerdown", (e) => {
		if (e.target.tagName === "BUTTON") return;
		const r = window.getBoundingClientRect();
		ox = e.clientX - r.left;
		oy = e.clientY - r.top;
		window.style.transform = "none";
		handle.setPointerCapture(e.pointerId);
		handle.style.cursor = "grabbing";
		e.preventDefault();
	});
	handle.addEventListener("pointermove", (e) => {
		if (!handle.hasPointerCapture(e.pointerId)) return;
		const x = Math.max(
			0,
			Math.min(
				globalThis.innerWidth - window.offsetWidth,
				e.clientX - ox,
			),
		);
		const y = Math.max(
			0,
			Math.min(
				globalThis.innerHeight - window.offsetHeight,
				e.clientY - oy,
			),
		);
		window.style.left = x + "px";
		window.style.top = y + "px";
	});
	handle.addEventListener("pointerup", () => {
		handle.style.cursor = "grab";
	});
}

// Forgot password window
const _forgotWindow = document.getElementById("forgot-window");
_makeDraggable(_forgotWindow, document.getElementById("forgot-drag-handle"));

function fetchEmailForUsername(username) {
	const errEl = document.getElementById("forgot-username-error");
	const btn = document.getElementById("forgot-submit");
	if (!username) {
		document.getElementById("forgot-email").value = "";
		state.send_password = "";
		errEl.style.display = "none";
		btn.disabled = true;
		return;
	}
	fetch(`/api/auth/email-hint?username=${encodeURIComponent(username)}`)
		.then((r) => r.json())
		.then((data) => {
			if (data.email) {
				state.send_password = data.email;
				document.getElementById("forgot-email").value = data.hint || "";
				errEl.style.display = "none";
				btn.disabled = false;
			} else {
				state.send_password = "";
				document.getElementById("forgot-email").value = "";
				errEl.textContent = "Username not found.";
				errEl.style.display = "";
				btn.disabled = true;
			}
		})
		.catch(() => {});
}

function openForgotWindow() {
	document.getElementById("forgot-message").textContent = "";
	document.getElementById("forgot-email").value = "";
	state.send_password = "";
	document.getElementById("forgot-username-error").style.display = "none";
	document.getElementById("forgot-submit").disabled = true;
	_forgotWindow.style.display = "";
	_forgotWindow.style.transform = "translateX(-50%)";
	_forgotWindow.style.left = "50%";
	_forgotWindow.style.top = "20%";
	const username = document.getElementById("auth-username").value.trim();
	document.getElementById("forgot-username").value = username;
	fetchEmailForUsername(username);
}

document
	.getElementById("auth-forgot-link")
	.addEventListener("click", openForgotWindow);
document.getElementById("forgot-close-btn").addEventListener("click", () => {
	_forgotWindow.style.display = "none";
});
document
	.getElementById("forgot-submit")
	.addEventListener("click", doForgotPassword);
document.getElementById("forgot-email").addEventListener("keydown", (e) => {
	if (e.key === "Enter") doForgotPassword();
});

// Look up email whenever username is typed in the forgot window
let _forgotUsernameTimer = null;
document.getElementById("forgot-username").addEventListener("input", (e) => {
	clearTimeout(_forgotUsernameTimer);
	_forgotUsernameTimer = setTimeout(
		() => fetchEmailForUsername(e.target.value.trim()),
		400,
	);
});

// Reset password window
const _resetWindow = document.getElementById("reset-screen");
_makeDraggable(_resetWindow, document.getElementById("reset-drag-handle"));
document.getElementById("reset-close-btn").addEventListener("click", () => {
	_resetWindow.style.display = "none";
	history.replaceState({}, "", location.pathname);
});

// Detect reset token in URL
const _resetToken = new URLSearchParams(location.search).get("reset_token");
if (_resetToken) {
	document.getElementById("auth-screen").style.display = "none";
	_resetWindow.style.display = "";
}
document
	.getElementById("reset-submit")
	.addEventListener("click", () => doResetPassword(_resetToken));

// Detect verify token in URL
const _verifyToken = new URLSearchParams(location.search).get("verify_token");
if (_verifyToken) {
	document.getElementById("auth-screen").style.display = "none";
	fetch("/api/auth/verify-email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: _verifyToken }),
	}).then(r => r.json()).then(data => {
		history.replaceState({}, "", location.pathname);
		if (data.error) {
			showVerifyScreen("", data.error + " You can request a new link below.");
		} else {
			const errEl = document.getElementById("auth-error");
			errEl.textContent = "Email verified. You can now log in.";
			errEl.style.color = "var(--accent)";
			document.getElementById("auth-screen").style.display = "flex";
		}
	}).catch(() => {
		showVerifyScreen("", "Verification failed. Please try again or request a new link.");
	});
}

// Verify screen wiring
document.getElementById("verify-resend-btn").addEventListener("click", doResendVerification);
document.getElementById("verify-back-link").addEventListener("click", () => {
	document.getElementById("verify-screen").style.display = "none";
	document.getElementById("auth-screen").style.display = "flex";
	history.replaceState({}, "", location.pathname);
});

// Command input
initInput({ saveOrigin, notify: (msg) => appendMsg(msg, "system") });
// The mic button beside it. Mounts hidden; the Voice Input setting is what
// reveals it, and it is off by default.
initDictation();
// …and the reader that speaks the log back. Observes #output, so it reads
// whatever reaches the log rather than hooking the three append helpers.
initLogReader();
// Focus trapping / Escape / focus-return for every floating panel, wired once
// rather than forty times. Observes the DOM, so a panel added later gets it free.
initA11yFocus();

// Panels
initTradePanel();
initRecipesPanel();
initStatsPanel();
initSkillsPanel();
initContainerPanel();
initWardrobePanel();
initWorkspacePanel();
initLootPanel();
initDialogue();
initForecast();
initWhisperPanel();
initWho();
initPlayersPanel();
initAtmPanel();
initInsurancePanel();
initWantedHud();
initTvPanel();
initMediaDeckPanel();
initMusicPlayerPanel();

window.addEventListener('game-disconnect', () => {
	stopMusicPlayer();
	stopEngineAudio();
	window.AudioEngine?.stop('music');
	window.AudioEngine?.stop('ambience');
	// Close the full-screen map popup (and its tooltip) — a disconnected map is stale
	// and can't be interacted with anyway.
	document.getElementById('map-panel')?.classList.remove('active');
	const mapTip = document.getElementById('map-tooltip');
	if (mapTip) mapTip.style.display = 'none';
});

// Wire signout
function doSignout() {
	// Flag to prevent auto-login on next page load
	sessionStorage.setItem("signed-out", "1");
	sessionStorage.removeItem("reconnect-token");
	sessionStorage.removeItem("game-switch-token");
	closeConnection();
	location.reload();
}
document.getElementById("signout-btn").addEventListener("click", () => {
	// Safe at home (your own locked apartment) — no warning, just log out.
	if (state.currentZone && state.currentZone === state.player?.home_zone) {
		doSignout();
		return;
	}
	showDangerDialog({
		title: "Sign Out",
		prompt: "Your body stays asleep exactly where you log out — it will remain in the world, vulnerable to anyone who finds it, until you return. Get somewhere safe (your apartment, locked) before signing out here.",
		confirmLabel: "Sign Out Anyway",
	}, doSignout);
});

// Mobile command fan-out: toggle the quick-cmds popup above the bar.
{
	const fanBtn = document.getElementById("cmd-fan-btn");
	const quickCmds = document.getElementById("quick-cmds");
	if (fanBtn && quickCmds) {
		fanBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			quickCmds.classList.toggle("open");
		});
		// Close after picking a command, or when tapping outside the popup.
		quickCmds.addEventListener("click", () =>
			quickCmds.classList.remove("open"),
		);
		document.addEventListener("click", (e) => {
			if (!quickCmds.contains(e.target) && e.target !== fanBtn) {
				quickCmds.classList.remove("open");
			}
		});
	}
}

// Quick-cmd buttons
document.querySelectorAll(".qcmd[data-cmd]").forEach((btn) => {
	btn.addEventListener("click", () => sendCmd(btn.dataset.cmd));
});

// Wake button — the sleep bar's only control. Sends the verb like any other
// button; the server's sleep_state reply is what hides the bar again, so the
// button never has to guess whether it worked.
document
	.getElementById("sleep-wake-btn")
	?.addEventListener("click", () => sendCmd("wake"));
document
	.querySelector(".qcmd[data-open-equip]")
	?.addEventListener("click", () => {
		import("./panels/tablet-os.js").then((m) => m.openTabletToInventory());
	});
document
	.querySelector(".qcmd[data-open-gear]")
	?.addEventListener("click", () => {
		import("./panels/tablet-os.js").then((m) => m.openTabletToLoadout());
	});
document
	.getElementById("debug-whisper-btn")
	?.addEventListener("click", debugFakeWhisper);
window._sendRaw = sendRaw;

// HUD minimap tap → open full map popup
document.getElementById("minimap-grid-hud")?.addEventListener("click", () => {
	sendCmd("map");
});

// Mobile chat button → tablet Chat app (replaces the floating whisper window)
document
	.getElementById("mobile-chat-btn")
	?.addEventListener("click", () => {
		import("./panels/tablet-os.js").then((m) => m.openTabletToChat());
	});

// Fire a d-pad button's command on RELEASE, not press — and only if the finger
// is still over the button it started on. Holding does nothing until you let
// go; sliding off before releasing cancels, so a fat-finger misplacement can be
// corrected by dragging away instead of committing to the wrong direction. A
// quick tap still works (press + release on the same button). Pointer events
// cover both touch and mouse; loc-dpad can show on desktop too.
function wireDpadPressRelease(container) {
	if (!container) return;
	let active = null; // the button currently pressed
	const isOver = (btn, x, y) => {
		const el = document.elementFromPoint(x, y);
		return !!el && (btn === el || btn.contains(el));
	};
	container.addEventListener("pointerdown", (e) => {
		const btn = e.target.closest(".dpad-btn[data-cmd]");
		if (!btn) return;
		e.preventDefault();
		active = btn;
		btn.classList.add("dpad-pressing");
		btn.setPointerCapture?.(e.pointerId);
	});
	container.addEventListener("pointermove", (e) => {
		if (!active) return;
		const on = isOver(active, e.clientX, e.clientY);
		active.classList.toggle("dpad-pressing", on);
		active.classList.toggle("dpad-cancel", !on);
	});
	const end = (e, commit) => {
		if (!active) return;
		const btn = active;
		active = null;
		btn.classList.remove("dpad-pressing", "dpad-cancel");
		if (commit && isOver(btn, e.clientX, e.clientY)) sendCmd(btn.dataset.cmd);
	};
	container.addEventListener("pointerup", (e) => end(e, true));
	container.addEventListener("pointercancel", (e) => end(e, false));
}

// Mobile dpad — send movement commands without opening the keyboard
wireDpadPressRelease(document.getElementById("mob-dpad"));

// The d-pad's centre cell cycles the button size small → medium → large,
// resizing every button via [data-dpad-size] on <html>. Persisted per browser.
const mobDpadSize = document.getElementById("mob-dpad-size");
if (mobDpadSize) {
	const SIZES = ["small", "medium", "large"];
	const applyDpadSize = (size) => {
		if (size === "small") delete document.documentElement.dataset.dpadSize;
		else document.documentElement.dataset.dpadSize = size;
		mobDpadSize.title = `D-Pad size: ${size} (tap to change)`;
	};
	const savedSize = localStorage.getItem("architect_dpad_size");
	applyDpadSize(SIZES.includes(savedSize) ? savedSize : "small");
	mobDpadSize.addEventListener("click", () => {
		const cur = document.documentElement.dataset.dpadSize || "small";
		const next = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length];
		localStorage.setItem("architect_dpad_size", next);
		applyDpadSize(next);
	});
}
// Location d-pad — movement + size toggle (auto fills available space up to the
// max; the resize button overrides with fixed 100% / 50% sizes)
const locDpad = document.getElementById("loc-dpad");
if (locDpad) {
	const MODES = ["auto", "full", "half"];
	const GLYPH = { auto: "⤢", full: "▣", half: "▪" };
	const resizeBtn = locDpad.querySelector(".dpad-resize-btn");
	const applyMode = (mode) => {
		locDpad.dataset.dpadMode = mode;
		if (resizeBtn) {
			resizeBtn.textContent = GLYPH[mode];
			resizeBtn.title = `D-Pad size: ${mode} (click to change)`;
		}
	};
	const saved = localStorage.getItem("architect_dpad_mode");
	applyMode(MODES.includes(saved) ? saved : "auto");
	resizeBtn?.addEventListener("click", () => {
		const next = MODES[(MODES.indexOf(locDpad.dataset.dpadMode) + 1) % MODES.length];
		localStorage.setItem("architect_dpad_mode", next);
		applyMode(next);
	});
	wireDpadPressRelease(locDpad);
}

// WASD keyboard movement — the location d-pad's centre button arms a mode where
// W/A/S/D drive N/W/S/E without opening the command box. Desktop only (the
// button lives in the desktop sidebar's loc-dpad). While armed the mode "takes
// focus": we blur the command input and a window-capture keydown intercepts the
// movement keys before the auto-focus handler in input.js can grab them. Click
// the command box to type — that unarms nothing, but an editable target lets the
// keys through so you can still write commands.
const wasdBtn = document.getElementById("loc-dpad-wasd");
if (wasdBtn) {
	const WASD = { w: "n", a: "w", s: "s", d: "e", q: "in", z: "out", e: "u", c: "d" };
	const cmdInput = document.getElementById("cmd-input");
	const setArmed = (on) => {
		state.wasdMove = on;
		wasdBtn.setAttribute("aria-pressed", on ? "true" : "false");
		if (on) cmdInput?.blur();
	};
	wasdBtn.addEventListener("click", () => setArmed(!state.wasdMove));
	// Embarking an aircraft: W/A/S/D become flight controls, so drop walk-mode if it was armed
	// (otherwise the capture handler below eats the keys before the flight sim ever sees them).
	window.addEventListener("flightsim:open", () => { if (state.wasdMove) setArmed(false); });
	window.addEventListener(
		"keydown",
		(e) => {
			if (!state.wasdMove || isFlightSimActive() || isHangarBayWalkActive() || isTruckDepotWalkActive()) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			// Let real text fields (command box, chat, tablet, dialogs) type normally.
			const tag = e.target.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
			const dir = WASD[e.key.toLowerCase()];
			if (!dir) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			sendCmd(dir);
		},
		true,
	);
}

// Poker command bar — buttons live in the area pane (re-rendered on every poker
// update, so this is delegated). data-cmd relays the real verb (labels may be
// aliases, e.g. "sit"→seat, "watch"→spectate); data-fill is an amount verb
// (bet/raise) — collect the amount via the themed confirm-window dialog and
// fire the full command.
document.getElementById("area-content")?.addEventListener("click", (e) => {
	const btn = e.target.closest(".poker-cmd");
	if (!btn) return;
	if (btn.dataset.fill != null) {
		const cmd = btn.dataset.fill.trim();
		const label = `${cmd[0].toUpperCase()}${cmd.slice(1)}`;
		// data-min carries the minimum legal wager — prefill it and floor the
		// input so the bet can't be submitted below the table minimum.
		const min = btn.dataset.min != null ? parseInt(btn.dataset.min, 10) : 1;
		showAmountDialog(
			{ title: label, prompt: `${label} how much?`, confirmLabel: label, min, value: min },
			(n) => sendCmd(`${cmd} ${n}`),
		);
	} else if (btn.dataset.cmd) {
		sendCmd(btn.dataset.cmd);
	}
});

// Mobile output scroll — touchstart/move on #output scrolls it, ignoring
// touches that begin on the map tab button or the minimap panel.
{
	const output = document.getElementById("output");
	let scrollTouchId = null;
	let scrollStartY = 0;
	let scrollStartTop = 0;

	output.addEventListener(
		"touchstart",
		(e) => {
			const touch = e.changedTouches[0];
			const hit = document.elementFromPoint(touch.clientX, touch.clientY);
			if (mobileMapTab?.contains(hit) || mobileMapPanel?.contains(hit))
				return;
			scrollTouchId = touch.identifier;
			scrollStartY = touch.clientY;
			scrollStartTop = output.scrollTop;
		},
		{ passive: true },
	);

	output.addEventListener(
		"touchmove",
		(e) => {
			if (scrollTouchId === null) return;
			const touch = [...e.changedTouches].find(
				(t) => t.identifier === scrollTouchId,
			);
			if (!touch) return;
			output.scrollTop = scrollStartTop - (touch.clientY - scrollStartY);
		},
		{ passive: true },
	);

	output.addEventListener(
		"touchend",
		(e) => {
			if (
				[...e.changedTouches].some(
					(t) => t.identifier === scrollTouchId,
				)
			) {
				scrollTouchId = null;
			}
		},
		{ passive: true },
	);
}

// Raw directions the server's `go` understands as a leading disambiguator.
const RAW_DIRS = ["north", "south", "east", "west", "up", "down", "in", "out", "exit"];

// Output / area pane: click .action-link nodes to auto-run command
function handleActionLinkClick(e) {
	const el = e.target.closest(".action-link");
	if (!el) return;
	// Client-side links: answered HERE, never sent to the server. This is the
	// difference between a clickable "Yes" and a broken one — a y/n prompt like
	// auto-walk's is consumed by handleClientCommand BEFORE the socket, so a link
	// that used sendCmd would sail straight past the pending prompt and hand the
	// server a bare "y" to be confused by.
	if (el.dataset.clientCmd) {
		handleClientCommand(el.dataset.clientCmd, {});
		// The prompt is one-shot: once answered, retire every button in the pair so
		// a second click can't re-answer a question that is no longer being asked.
		const group = el.dataset.clientGroup;
		if (group) {
			for (const n of document.querySelectorAll(`[data-client-group="${CSS.escape(group)}"]`)) {
				n.classList.add("prompt-link-spent");
				delete n.dataset.clientCmd;
			}
		}
		return;
	}
	// Verbatim-command links (SIFT picks, RENT prompt, …) bypass the
	// action+target verb construction below and send the raw text as-is.
	if (el.dataset.rawCmd) {
		sendCmd(el.dataset.rawCmd, el.dataset.label);
		return;
	}
	const action = el.dataset.action;
	const target = el.dataset.target;
	// Command links (data-action="cmd" data-cmd="…") send the verb verbatim —
	// used by the flight hangar/ramp service links (hangar/refuel/buy/embark/…).
	if (action === "cmd" && el.dataset.cmd) {
		sendCmd(el.dataset.cmd, el.dataset.label);
		return;
	}
	if (!action) return;
	// A VERB WITH NO OBJECT IS STILL A VERB. `teachVerb('yard')` — the no-target form, which 27
	// call sites across the game use — renders a link carrying `data-action` and nothing else, and
	// this used to return here and swallow the click. Every bare-verb teach link in the game was
	// dead: `drive`, `yard`, `haul`, `market`, `park`, `bounty`, `redeem`, `accessibility`, all of
	// them. They LOOKED like links, shimmered like links, and did nothing, which is worse than not
	// being links at all — the shimmer is the game promising a player that clicking is how this
	// works. Send the bare verb, which is exactly what the label says it is.
	if (!target) { sendCmd(action, el.dataset.label || action); return; }
	// Exit/building/room links carry data-dest (the destination name) — click by
	// name so SIFT reaches the specific location even when several exits share a
	// direction. data-target stays the raw direction for the dpad highlight.
	const dest = el.dataset.dest;
	// Enemy links carry a unique instance id so clicking a specific enemy targets
	// exactly that one — the only way to reach the second of two same-named enemies
	// (the typed "attack <name>" path can only ever hit the FATE default).
	const instanceId = el.dataset.instanceId;
	// Send the drawn direction alongside the name: the server resolves the name
	// within that direction, and falls back to plain movement if it can't.
	const destDir = dest && action === "go" && RAW_DIRS.includes((target || "").toLowerCase())
		? `${target.toLowerCase()} `
		: "";
	const cmd = dest
		? `go ${destDir}${dest.toLowerCase()}`
		: instanceId
			? `${action} ${instanceId}`
			: `${action} ${target.toLowerCase()}`;
	const label = el.dataset.label;
	sendCmd(cmd, label ? `${action} ${label}` : (dest ? `go ${dest}` : `${action} ${target.toLowerCase()}`));
}
document
	.getElementById("output")
	.addEventListener("click", handleActionLinkClick);
document
	.getElementById("area-pane")
	.addEventListener("click", handleActionLinkClick);
// Minimap mounts: enterable-building tiles render as action-links (go <name>).
// Delegated on the containers so the constant innerHTML re-renders keep working.
for (const id of ["minimap-grid", "minimap-grid-mob", "minimap-grid-hud"]) {
	document.getElementById(id)?.addEventListener("click", handleActionLinkClick);
}

// Look pane / output pane resize handle
(function () {
	const handle = document.getElementById("look-resize-handle");
	const resetBtn = document.getElementById("look-resize-reset");
	const pane = document.getElementById("area-pane");
	const container = document.getElementById("output-container");
	const STORAGE_KEY = "lookPaneHeight";

	function setManual(heightPx) {
		pane.style.height = heightPx + "px";
		pane.style.maxHeight = "";
		handle.classList.add("manual");
		localStorage.setItem(STORAGE_KEY, heightPx + "px");
	}

	function setAuto() {
		pane.style.height = "";
		pane.style.maxHeight = "";
		handle.classList.remove("manual");
		localStorage.removeItem(STORAGE_KEY);
	}

	// Restore saved manual height, or start in auto mode
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved) {
		pane.style.height = saved;
		handle.classList.add("manual");
	}

	// In auto mode, reset to auto on each content update so the pane re-fits.
	//
	// ⚠ NEVER WHILE THE HANDLE IS BEING HELD. A pane only becomes "manual" on mouseup, so a drag
	// that started from auto was still auto all the way through — and any content update landing
	// mid-drag (a panel re-push, a room repaint, a combat refresh) wiped the height out from under
	// the cursor. The pane snapped back to its auto size halfway through the drag and the rest of
	// the gesture did nothing. Dragging IS the manual intent; the mouse merely hasn't come up yet.
	pane.addEventListener("contentupdate", () => {
		if (
			!handle.classList.contains("manual") &&
			!handle.classList.contains("dragging")
		) {
			pane.style.height = "";
		}
	});

	// Full-pane apps (the hangar bay) snap the pane back to its default auto size on
	// open so the whole interface fits, overriding any manual drag height the player
	// left on an ordinary room look.
	pane.addEventListener("lookpaneauto", () => setAuto());

	resetBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		setAuto();
	});

	handle.addEventListener("dblclick", () => setAuto());

	let startY, startH;

	handle.addEventListener("mousedown", (e) => {
		if (e.target === resetBtn) return;
		startY = e.clientY;
		startH = pane.getBoundingClientRect().height;
		handle.classList.add("dragging");
		document.body.style.userSelect = "none";
		document.body.style.cursor = "ns-resize";

		function onMove(e) {
			const delta = e.clientY - startY;
			const containerH = container.getBoundingClientRect().height;
			const newH = Math.min(
				containerH - 80,
				Math.max(40, startH + delta),
			);
			pane.style.height = newH + "px";
			pane.style.maxHeight = "";
		}

		function onUp() {
			handle.classList.remove("dragging");
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
			handle.classList.add("manual");
			localStorage.setItem(STORAGE_KEY, pane.style.height);
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
		}

		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});

	// Touch support
	handle.addEventListener(
		"touchstart",
		(e) => {
			const t = e.touches[0];
			startY = t.clientY;
			startH = pane.getBoundingClientRect().height;
			handle.classList.add("dragging");

			function onMove(e) {
				const t = e.touches[0];
				const delta = t.clientY - startY;
				const containerH = container.getBoundingClientRect().height;
				const newH = Math.min(
					containerH - 80,
					Math.max(40, startH + delta),
				);
				pane.style.height = newH + "px";
				pane.style.maxHeight = "";
			}

			function onEnd() {
				handle.classList.remove("dragging");
				handle.classList.add("manual");
				localStorage.setItem(STORAGE_KEY, pane.style.height);
				handle.removeEventListener("touchmove", onMove);
				handle.removeEventListener("touchend", onEnd);
			}

			handle.addEventListener("touchmove", onMove, { passive: true });
			handle.addEventListener("touchend", onEnd);
		},
		{ passive: true },
	);
})();

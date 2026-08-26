// THE COMPACT VIEW — one answer to "is this a phone?", for the six panels that take over the pane.
//
// The flight sim, the cockpit, the helm, the hangar, the truck depot and the truck cab all do the
// same thing: mount a view in `#area-pane` and let the scrollback log keep the bottom of the
// column. On a desktop that is right — the log is half of why you are playing a MUD. On a phone
// the pane is a third of a screen the view was already fighting for, and the log wins by default,
// which is how the cab ended up showing 100% controls and no road.
//
// ⚠ ONE DEFINITION, NOT SIX. Every one of these panels has its own `*-hidepanel` body class and its
// own toggle button, and the temptation is a `matchMedia` line in each file. Six copies of a media
// query is six chances for one of them to drift to `max-width:768px` and behave differently from
// its neighbours for no reason anybody could find. The cab's stylesheet interpolates this same
// string, which is what keeps its CSS and its JS deciding the same thing.
//
// It is `pointer:coarse` AS WELL AS a width, for the reason the touch-only controls already are: a
// narrow window on a desktop still has a keyboard and a scrollback worth reading, and a tablet in
// landscape still does not.
export const COMPACT_MQ = '(max-width:760px) and (pointer:coarse)';

export const isCompactView = () => {
  try { return matchMedia(COMPACT_MQ).matches; } catch { return false; }
};

// Fold the log away on a phone, using the panel's OWN toggle rather than a second mechanism — so
// the button reads as pressed, one tap gives the log straight back, and the panel's existing
// teardown already clears the class.
//
// ⚠ A DEFAULT, NEVER A LOCK. Nothing re-applies it: a player who wants the log open keeps it open
// for the rest of the flight, the voyage or the leg. Re-asserting it on a tick or a re-render is
// the version of this that reads as a bug.
export function compactHidePanel(bodyClass, btn) {
  if (!isCompactView()) return false;
  document.body.classList.add(bodyClass);
  btn?.classList?.add('on');
  return true;
}

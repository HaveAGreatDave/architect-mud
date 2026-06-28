// Thin bridge so AI conditions can query broadcast state without circular imports.
// Populated by the broadcast plugin at startup via registerViewerChecker().
let _viewerChecker = null;
export function registerViewerChecker(fn) { _viewerChecker = fn; }
export function hasChannelViewers(channelId) { return _viewerChecker ? _viewerChecker(channelId) : false; }

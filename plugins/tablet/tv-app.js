// Tablet OS — TV app. A portable television: unlike the wall sets (which need a
// `broadcast_receiver` device in the room), the tablet is its own receiver and
// streams any channel from anywhere. See the "Tablet TV (portable tuner)" pass in
// plugins/broadcast/index.js for how content actually reaches it.
//
// The screen itself is rendered natively by the client (tablet-os.js `view: 'tv'`),
// which mounts the SHARED TV renderer (client/game/js/panels/tv.js createTvView)
// into a tablet-styled viewport — the same renderer the standalone CRT set uses, so
// the app gets every broadcast feature (tuner, guide, gameday, score-bug, sports FX,
// themes, ticker, read-aloud) for free. Tuning rides the `tablettune` command and
// the tablet_tv_watch/unwatch raw messages, not tabletaction round-trips, so the
// dial behaves like a real dial instead of a page nav.
//
// This module therefore only supplies the channel dial listing + the currently
// tuned channel. Both come out of the broadcast plugin's in-memory channel runtime
// — never a DB read, since buildScreen runs on every tablet nav.
import { registerTabletApp } from './registry.js';
import { getTvChannelList, getTabletTunedChannel } from '../broadcast/index.js';

async function buildScreen(player) {
  const channels = getTvChannelList();
  return {
    view: 'tv',
    breadcrumb: ['TV'],
    channels,
    tuned: getTabletTunedChannel(player.id),
  };
}

registerTabletApp({
  id: 'tv', name: 'TV', icon: '📺', category: 'Media',
  buildScreen,
});

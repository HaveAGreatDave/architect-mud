import { query } from '../models/db.js';

export const DEFAULT_BIG = `Connected: <date> as <player name>
▓█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▓
▓█  [▲] SECURITY_OVERRIDE_ON                                            STREAM_LINK_0x7F9B93   [▲]  █▓
▓█                                                                                                  █▓
▓█              █████╗ ██████╗  ██████╗██╗  ██╗██╗███████╗███████╗ ██████╗███████╗                █▓
▓█             ██╔══██╗██╔══██╗██╔════╝██║  ██║██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝                █▓
▓█             ███████║██████╔╝██║     ███████║██║   ██║   █████╗  ██║        ██║                   █▓
▓█             ██╔══██║██╔══██╗██║     ██╔══██║██║   ██║   ██╔══╝  ██║        ██║                   █▓
▓█             ██║  ██║██║  ██║╚██████╗██║  ██║██║   ██║   ███████╗╚██████╗   ██║                   █▓
▓█             ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝ ╚═════╝   ╚═╝                   █▓
▓█                                                                                                  █▓
▓█  [▼] KERNEL_ENG_INIT_OK                                              HOST_NODE_ACTIVE       [▼]  █▓
▓█▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█▓
║                                                                                                    ║
║                                     Welcome to Architect MUD                                       ║
║                                     ~~~~~~~~~~~~~~~~~~~~~~~~                                       ║
║                                                                                                    ║
║                                                                                                    ║
║  Message of the Day: <dynamic text>                                                                ║
║ ╠══════════════════════════════════════════════════════════════════════════════════════════════╣ ║
║                                                                                                    ║
║  WORLD BRIEF:                                                                                      ║
║  Coldwater Basin is a fractured post-collapse megastructure where the world never truly ended—     ║
║  only degraded into competing layers of broken systems.                                            ║
║                                                                                                    ║
║  Buried AI networks still manage infrastructure that no one fully understands. Mutations spread    ║
║  through contaminated zones. Factions carve territory out of ruins, data, and steel. Every         ║
║  district is a different rule set waiting to be discovered, exploited, or rewritten.               ║
║                                                                                                    ║
║  You are not entering a world that reacts to you—you are entering one that continues without you.  ║
║                                                                                                    ║
║  BASIC STARTER COMMANDS:                                                                           ║
║  - look              : Examine your surroundings                                                   ║
║  - move <dir>        : Travel (north, south, east, west, etc.)                                     ║
║  - say <message>     : Speak locally                                                               ║
║  - inventory         : Check what you carry                                                        ║
║                                                                                                    ║
║  Need more help?                                                                                   ║
║  - type "help" for full command reference                                                          ║
║  - speak to Angus in the Coldwater Clone Facility for guided tutorial assistance                   ║
║                                                                                                    ║
║ ╠══════════════════════════════════════════════════════════════════════════════════════════════╣ ║
║  RECENT NEWS:                                                                                      ║
║ ╠══════════════════════════════════════════════════════════════════════════════════════════════╣ ║
║  [No recent broadcasts available]                                                                  ║
║                                                                                                    ║
║  > The world is constantly changing. New events, faction activity, and system alerts               ║
║    will appear here as they occur.                                                                 ║
║ ╠══════════════════════════════════════════════════════════════════════════════════════════════╣ ║
║                                                                                                    ║
║  TIP:                                                                                              ║
║  Pay attention to patterns in the environment. The system rarely explains itself twice.            ║
║                                                                                                    ║
╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗`;

export const DEFAULT_MEDIUM = `Connected: <date> as <player name>
▓█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▓
▓█ [▲] SEC_OVERRIDE_ON       LINK_0x7F9B93 [▲] █▓
▓█      █▀█ █▀▄ █▀▀ █░█ █ ▌█▐ █▀▀ █▀▀ ▌█▐      █▓
▓█      █▀█ █▀▄ █▄▄ █▀█ █ ░█░ █▄▄ █▄▄ ░█░      █▓
▓█ [▼] KERNEL_INIT_OK          NODE_ACTIVE [▼] █▓
▓█▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█▓
║                                               ║
║            Welcome to Architect MUD           ║
║            ~~~~~~~~~~~~~~~~~~~~~~~~           ║
║                                               ║
║                                               ║
║  Message of the Day: <dynamic text>           ║
║ ╠═══════════════════════════════════════════╣ ║
║                                               ║
║  WORLD BRIEF:                                 ║
║  Coldwater Basin is a fractured post-         ║
║  collapse megastructure where the world       ║
║  never truly ended—only degraded into         ║
║  competing layers of broken systems.          ║
║                                               ║
║  Buried AI networks still manage automated    ║
║  infrastructure that no one understands.      ║
║  Mutations spread through hot zones.          ║
║  Factions carve out territory from steel.     ║
║                                               ║
║  BASIC STARTER COMMANDS:                      ║
║  - look          : Examine surroundings       ║
║  - move <dir>    : Travel (n, s, e, w)        ║
║  - say <msg>     : Speak locally              ║
║  - inventory     : Check your items           ║
║                                               ║
║  Need more help?                              ║
║  - type "help" for full reference             ║
║  - speak to Angus in Clone Facility           ║
║                                               ║
║                                               ║
║  TIP:                                         ║
║  Pay attention to patterns in the             ║
║  environment. The system rarely               ║
║  explains itself twice.                       ║
║                                               ║
╚═══════════════════════════════════════════════╝
  ╠═══════════════════════════════════════════╣
               RECENT NEWS:
  ╠═══════════════════════════════════════════╣
    [No recent broadcasts available]

   > The world is constantly changing.

  ╠═══════════════════════════════════════════╣`;

export const DEFAULT_SMALL = `Connected: <date> as <player name>
▓█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▓
▓█   █▀█ █▀▄ █▀▀ █░█ █ ▌█▐ █▀▀ █▀▀ ▌█▐  █▓
▓█   █▀█ █▀▄ █▄▄ █▀█ █ ░█░ █▄▄ █▄▄ ░█░  █▓
▓█▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄██▓
║ Welcome to Architect MUD               ║
║                                        ║
║ ╠════════════════════════════════╣     ║
║ BRIEF: Post-collapse megastructure     ║
║ run by broken AI networks.             ║
║                                        ║
║ COMMANDS:                              ║
║ - look      : See room                 ║
║ - move <dir>: Travel                   ║
║ - say <msg> : Speak                    ║
║ - inv       : Items                    ║
║ - help      : Full docs                ║
║                                        ║
║ TIP: Watch for world patterns.         ║
╚════════════════════════════════════════╗
  ╠═════════════════════════════════╣
               RECENT NEWS:
  ╠═════════════════════════════════╣
   [No recent broadcasts available]

  > The world is constantly changing.

  ╠═════════════════════════════════╣`;

export async function getMotd() {
  const { rows } = await query("SELECT key, value FROM server_settings WHERE key IN ('motd_big','motd_medium','motd_small','motd_dynamic')").catch(() => ({ rows: [] }));
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    big:     map.motd_big     || DEFAULT_BIG,
    medium:  map.motd_medium  || DEFAULT_MEDIUM,
    small:   map.motd_small   || DEFAULT_SMALL,
    dynamic: map.motd_dynamic ?? '',
  };
}

export async function saveMotd({ big, medium, small, dynamic: dyn }) {
  const updates = [];
  if (big)    updates.push(['motd_big',     big]);
  if (medium) updates.push(['motd_medium',  medium]);
  if (small)  updates.push(['motd_small',   small]);
  if (typeof dyn === 'string') updates.push(['motd_dynamic', dyn]);
  for (const [key, value] of updates) {
    await query("INSERT INTO server_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, value]);
  }
}

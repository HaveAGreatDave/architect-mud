# worldmap

**Purpose** — the whole surface world on one screen: the placed regions, the wildlands between them and this week's numbered highways. A tablet app (**World Map**) and a text verb, `worldmap`, that prints the same picture as a character map with the routes listed underneath, so it reaches the log at every Display Mode rung.

The server sends only what it alone knows: the placed tiles, one character per tile by biome, and the roads as world-tile polylines with their route numbers. The ground between the regions is drawn by the client from `client/shared/wildlands.js`, the same function that decides it for the flight floor, the highway verges and the walked void, so the map cannot show ground the game does not have. The renderer is `client/shared/worldmap-render.js`, which the tablet loads only when the app opens.

Route numbers and highway types are content: `content/map/routes.json`, keyed by the two regions a road joins. The map draws each piece of tarmac once, by type, with the numbers that run on it, plus the walkers' footpaths as thin dotted tracks. Road condition (good/worn/broken) is a 3-D effect only and is deliberately not on the map. Landforms (Mount Cinder) and the region halos are `content/map/wildlands.json`. Both are baked into `client/shared/wildlands-field.js` by `npm run wildlands:bake`.

## Registered actions

None.

## Events emitted

None.

## Verbs

`worldmap` — the text map.

## Tablet apps

`worldmap` — the canvas map: zoom, pan, hover for what a tile is, "you" marked. Everything is visible; there is no fog of war.

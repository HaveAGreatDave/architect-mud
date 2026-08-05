// Audio plugin regress.
//
// One case, and it is the one that shipped a bug: WHAT COUNTS AS A POWER DEVICE.
// The industrial ambient bed — the power-station roar and the utility-room hum —
// is chosen by looking for the room's power device, and that test used to be
// "has an HP bar", i.e. destructible. A microwave is destructible. So every
// Solenne apartment, the four Merrow units, the grocery and the laundromat ran a
// machine-room drone off a kitchen appliance, a folding table and a row of
// dryers, permanently, with nothing in the room to explain the noise.
export default async ({ check }) => {
  const { isPowerDevice } = await import('./index.js');

  check('a generator is a power device', isPowerDevice({ object_type: 'generator', hp_max: 100 }));
  check('…and so is a junction box', isPowerDevice({ object_type: 'junction_box', hp_max: 40 }));

  // The bug, pinned. Every one of these is a real row in the world that used to
  // qualify — same shape, same hp_max, no business humming.
  check('a microwave is NOT, however breakable',
    !isPowerDevice({ object_type: 'fixture', name: 'Polaris Executive Convection Unit', hp_max: 40 }));
  check('…nor a row of dryers', !isPowerDevice({ object_type: 'fixture', name: 'facing row of dryers', hp_max: 30 }));
  check('…nor a folding table', !isPowerDevice({ object_type: 'furniture', name: 'folding table', hp_max: 10 }));

  // An indestructible junction box is a content error, not a hum: the bed is for
  // a device that can be smashed to kill it, so no hp_max means no bed.
  check('a power device with no HP bar does not count', !isPowerDevice({ object_type: 'junction_box', hp_max: null }));
  check('and nothing at all does not throw', !isPowerDevice(null) && !isPowerDevice(undefined));
};

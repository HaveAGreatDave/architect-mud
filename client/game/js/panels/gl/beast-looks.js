// THE BEASTS ROOM DRAWS FROM THE KIT: which fauna models have a close-up body (gl/beast-kit.js) for the Room Stage.
//
// GLASS keeps its own model for the street (fauna3d.js): a hound seen from a cab is a few dozen facets and should
// stay so. Up close in a room the same animal is drawn here, to the close-up figure's standard. The colours come off
// the fauna row, so a gutter hound in a flat is the colour of the one in Bracken's pack; the shape is the kit's.
// A fauna model with no entry here is drawn from GLASS's model, as before (gl/room-beasts.js).
import { QUADRUPED_ROWS } from '../../../../shared/fauna-models.js';
import { quadruped } from './beast-kit.js';

/** A hound off its fauna row: rangy, scarred and quick, the head low and the hackles up. */
export function houndLook(row = QUADRUPED_ROWS.hound || {}) {
  return {
    seed: 4, len: 0.66, legLen: 0.98, legW: 1.08, waist: 0.82, chestD: 1.06, chestW: 0.95, haunch: 1.1, arch: 0.55, slope: -0.01,
    neckRise: 0.42, headPitch: 0.38, neckW: 1.0, stance: 1.3,
    ribs: 0.9, scars: 5, mange: 0.35, hackles: 1.1 * (row.hackle ?? 0.8), shag: 0.75,
    coat: row.bodyCol || '#35292a', back: row.crownCol || '#151012', belly: row.bellyCol || '#a0603a', legs: row.legCol || '#221a19',
    paws: '#161010', patch: null,
    head: {
      face: 'dog', inner: '#6a3a34', gape: 0.32 * (row.gape ?? 0.35) / 0.35, eyeGlow: !!row.eyeGlow, iris: row.eyeCol || '#ff7a1a', col: row.headCol || '#2e2422', cheek: row.cheekCol || '#8a4a2e',
      ears: (sd) => (sd > 0 ? 'prick' : 'stub'), earLen: 0.11, brow: 1.0, nose: row.billCol || '#141012', tufts: 0.7, skullW: 0.95, muzzle: 0.15,
    },
    tail: { len: row.tailLen || 0.42, r: 0.024, lift: 0.1, curl: -0.28, col: row.tailCol || '#2a2120' },
  };
}

// fauna id ('kind/id') to a builder (M, t) in metres, model space (gl/beast-kit.js)
export const BEAST_LOOKS = {
  'quadruped/hound': (M, t) => quadruped(M, houndLook(), t),
};

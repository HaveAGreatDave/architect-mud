// THE HOVER CARS: the class the Corvane Merlin started (docs/proposals/hover-cars.md).
//
// A hover car is a two-seat mini VTOL built like a car: four ducted fans where the wheels would be,
// a pusher in the tail, three feet with mag-lock pucks, and HOVER, LOCK, BOOST and PIT on the wheel
// (client/game/js/panels/merlin-modes.js). Its class is its id, and so is its craft type.
//
// This is the one list of them. Code that used to ask "is this the Merlin" asks `isHoverCar(cls)`,
// and reads what differs from car to car off the row: which flight-model rows it flies and drives on,
// where its pusher's nozzle is for the boost flame, how long it is. A new car is a row here plus its
// own files (cabin-<id>.js, interior-<id>.js, mesh_<id>.json, ac_<id>.json).
//
// Pure data: no imports, so the server, the gates and the browser all read it.
//
//   air, road   the heli row and the road row in flight-model.js TYPES
//   lengthM     nose to tail, metres
//   nozzle      the pusher's mouth in model units [f, g, h], and `bore` its radius: the boost flame
//   washM       the four fans' footprint over water, metres
//   acc, rgb    the 2-D panel's accent: the maker's light line
//   doors       what the DOORS button says they are
export const HOVER_CARS = {
  merlin: { id: 'merlin', name: 'Merlin', maker: 'corvane', air: 'merlin', road: 'merlin_road', lengthM: 4.6,
    nozzle: [-0.835, 0, 0.035], bore: 0.05, washM: 5, acc: '#a896ff', rgb: [168, 150, 255], doors: 'gull wing' },
  lanner: { id: 'lanner', name: 'Lanner', maker: 'hallard', air: 'lanner', road: 'lanner_road', lengthM: 4.9,
    nozzle: [-0.865, 0, 0.035], bore: 0.045, washM: 5, acc: '#54e2d0', rgb: [84, 226, 208], doors: 'front-hinged' },
  bustard: { id: 'bustard', name: 'Bustard', maker: 'garrow', air: 'bustard', road: 'bustard_road', lengthM: 4.7,
    nozzle: [-0.855, 0, 0.035], bore: 0.055, washM: 5.6, acc: '#d6e8ff', rgb: [214, 232, 255], doors: 'scissor' },
};

export const HOVER_CAR_IDS = Object.keys(HOVER_CARS);
export const isHoverCar = (cls) => Object.prototype.hasOwnProperty.call(HOVER_CARS, cls);
export const hoverCar = (cls) => (isHoverCar(cls) ? HOVER_CARS[cls] : null);

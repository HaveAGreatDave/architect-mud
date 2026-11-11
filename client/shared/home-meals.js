// client/shared/home-meals.js
//
// WHAT RESIDENTS COOK AT HOME in the Room Stage: plugins/roomstage/npc-life.js picks a dish and sends its
// id, and gl/room-meals.js draws it. A resident takes it out of the fridge, cooks it on the hob or on a
// camping stove on the floor, and eats it sat down or stood up.
//
// Each dish: `cook` is what it's cooked in (pan, pot, wok), `serve` what it's eaten from (plate, bowl,
// tin), `food` its colours, sRGB hex, the first the most of it, and `bits` how lumpy it is (0 a smooth
// soup, 1 a plate of pieces). `get`, `cook` and `eat` lines go after the resident's name.

export const HOME_DISHES = [
  { id: 'noodles', cook: 'wok', serve: 'bowl', food: ['#d8b860', '#5a8a3a', '#a04a2a'], bits: 0.35,
    get: 'takes a packet of noodles and a bag of greens out of the {piece}.', cooking: 'tips the noodles into the wok and keeps them moving.', eat: 'eats noodles out of the bowl, slurping.' },
  { id: 'eggs', cook: 'pan', serve: 'plate', food: ['#f2efe2', '#f0b020', '#c08a50'], bits: 0.6,
    get: 'takes two eggs out of the {piece} and shuts it with an elbow.', cooking: 'cracks two eggs into the pan.', eat: 'eats fried eggs, mopping up the yolk.' },
  { id: 'stew', cook: 'pot', serve: 'bowl', food: ['#6a3e22', '#c07a30', '#8a9a40'], bits: 0.5,
    get: 'gets a tub of yesterday\'s stew out of the {piece}.', cooking: 'heats the stew up, stirring it so it doesn\'t catch.', eat: 'eats stew, blowing on each spoonful.' },
  { id: 'beans', cook: 'pan', serve: 'plate', food: ['#c0502a', '#d8b070', '#a03a20'], bits: 0.45,
    get: 'takes a tin of beans and the end of a loaf out of the {piece}.', cooking: 'warms a tin of beans and toasts the bread in the same pan.', eat: 'eats beans on toast with a fork.' },
  { id: 'curry', cook: 'pot', serve: 'bowl', food: ['#d08020', '#f2ead8', '#6a8a2a'], bits: 0.4,
    get: 'takes a tub of curry and some rice out of the {piece}.', cooking: 'heats the curry up. The room starts to smell of it.', eat: 'eats curry and rice, sniffing.' },
  { id: 'soup', cook: 'pot', serve: 'bowl', food: ['#b03a2a', '#e8d8b0', '#4a7a3a'], bits: 0.05,
    get: 'takes a carton of soup out of the {piece}.', cooking: 'pours soup into a pot and heats it.', eat: 'drinks soup straight from the bowl.' },
  { id: 'slab', cook: 'pan', serve: 'plate', food: ['#c08a8a', '#e0d0a0', '#6a9a4a'], bits: 0.7,
    get: 'takes a vat-grown slab out of the {piece} and reads the date on it.', cooking: 'fries a slab of vat protein. It hisses and goes grey.', eat: 'saws at a slab of vat protein with a blunt knife.' },
  { id: 'fish', cook: 'pan', serve: 'plate', food: ['#e8d8b8', '#c09040', '#e0e070'], bits: 0.6,
    get: 'takes a fillet of Basin fish out of the {piece}.', cooking: 'fries a fish fillet skin down.', eat: 'picks bones out of a piece of fish.' },
  { id: 'dumplings', cook: 'pot', serve: 'bowl', food: ['#ece2c8', '#8a6a3a', '#5a8a4a'], bits: 0.8,
    get: 'takes a bag of frozen dumplings out of the {piece}.', cooking: 'drops dumplings into boiling water one at a time.', eat: 'eats dumplings, dipping each one.' },
  { id: 'porridge', cook: 'pot', serve: 'bowl', food: ['#d8c8a0', '#8a3a4a', '#c8a060'], bits: 0.1,
    get: 'takes the oats and a bottle of milk out of the {piece}.', cooking: 'stirs a pot of porridge.', eat: 'eats porridge with a big spoon.' },
  { id: 'friedrice', cook: 'wok', serve: 'bowl', food: ['#e0c890', '#e07a30', '#5a9a3a'], bits: 0.55,
    get: 'takes a tub of cold rice and an egg out of the {piece}.', cooking: 'fries last night\'s rice with an egg broken into it.', eat: 'eats fried rice, quickly.' },
  { id: 'sausages', cook: 'pan', serve: 'plate', food: ['#8a4a2a', '#ece0b8', '#6a4a20'], bits: 0.65,
    get: 'takes a pack of sausages out of the {piece}.', cooking: 'turns sausages in the pan with a fork.', eat: 'eats sausages and mash.' },
  { id: 'kelp', cook: 'pot', serve: 'bowl', food: ['#4a6a3a', '#a89a60', '#e8e0c8'], bits: 0.25,
    get: 'takes a bundle of dried kelp and a stock cube out of the {piece}.', cooking: 'boils kelp in stock. It smells of the harbour.', eat: 'eats kelp broth and pulls a face.' },
  { id: 'ration', cook: 'pan', serve: 'tin', food: ['#9a8a6a', '#7a6a4a', '#b0a070'], bits: 0.3,
    get: 'takes a ration tin out of the {piece} and turns it over in their hand.', cooking: 'heats a ration tin in a pan of water.', eat: 'eats out of the ration tin with a spoon.' },
];
const BY_ID = new Map(HOME_DISHES.map((d) => [d.id, d]));
export const dishOf = (id) => BY_ID.get(id) || HOME_DISHES[0];

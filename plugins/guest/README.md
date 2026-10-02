# guest

Guest characters: play from a name alone, keep the character with `register`. The full write-up is [docs/systems-guests.md](../../docs/systems-guests.md).

## Verbs

- `register`: for a guest, opens the claim form (`claim_form`). The client sends the username, password and email back as `claim_account`, which `server/index.js` hands to `claimGuestAccount`. A full account gets a refusal.

## Hooks and ticks

- `player.login`: tells a guest the browser is their only way back, and how to keep the character.
- `schedule('1h')`, throttled to every 6 hours: `sweepGuests()` purges guests unseen for 7 days through `purgePlayers` (one batch, one statement per table).

## Lives elsewhere

- Creation: the `auth_guest` WebSocket handler in `server/index.js`.
- What a guest can't do: `server/engine/guest.js`, read at dispatch.
- Name rules, the shared INSERT and the purge: `server/engine/new-player.js`.

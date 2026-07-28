# insurance

**Purpose** — Halcyon Assurance: per-aircraft hull insurance, run out of the Halcyon tower. Buy a fixed-term policy at the underwriting desk; a covered crash files a claim you collect at the claims desk.

## The anti-kamikaze design
A payout is deliberately **partial**: a fraction of agreed value, minus a fat excess, and **the insurer keeps the wreck**. Every paid claim then **surcharges your future premiums**. The result is that insurance softens a crash without making aircraft disposable — you can afford one bad landing, not a habit of them.

## Commands
- `insure` — buy a policy at the desk.
- `insurebind` — point-of-sale bind for one aircraft; surfaced as an action-link in the flight dealer's buy confirmation.
- `claim` — collect. Also filed automatically on a covered crash.
- `policies` / `policy` — read-only status.

## Events consumed
- `flight.crashed` (from the flight plugin).

## Data schema
- `insurance_policies`, `insurance_claims`

## Discovery gaps (known)
The desks are **zone flags**, not examinable objects, so `insure` and `claim` are not examine-surfaced.

## Follow-on
Property and other assets. Aircraft first.

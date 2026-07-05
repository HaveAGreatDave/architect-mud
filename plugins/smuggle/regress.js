/**
 * smuggle plugin regress — the tag-gated `unpack` verb fails safe with no crate.
 * Ordering now happens through the fence's dialogue (PLACE_SMUGGLE_ORDER action)
 * rather than a command, and the checkpoint gate / delivery tick can't be driven
 * from the command harness, so this just asserts `unpack` doesn't throw when the
 * player is holding no MULE crate.
 */
export default async ({ run, check }) => {
  const r = await run('unpack');
  check('unpack with no crate is handled (no throw)', r && typeof r === 'object' && r.type,
    JSON.stringify(r)?.slice(0, 120));
};

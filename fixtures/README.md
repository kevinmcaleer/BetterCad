# Fixtures

Real models that once broke BetterCad (#106), kept so the bug stays fixed. The nightly run opens every `.bcad` here,
rebuilds it at fine quality, and checks its bodies against the `.expected.json` beside it (volume, area and face count).
It also exports each one to STL and STEP and reads them back.

## Adding one with a bug fix

1. Ask the person who reported it whether you may keep the model. Then anonymise it: rename the model and its parts,
   and drop anything personal from feature names.
2. Put it in a folder named for the issue, such as `fixtures/123-fillet-on-seam/model.bcad`.
3. Write its expectations once the fix is in: `NIGHTLY=1 UPDATE_GOLDEN=1 npm run test:nightly`.
4. Check the new `.expected.json` by hand. Do the volume and face count make sense for the model?
5. Commit both files with the fix.

`format/schema1.bcad` is the first saved-file format's test model. It isn't a bug, but it keeps the old format opening.

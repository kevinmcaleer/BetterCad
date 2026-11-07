# Sample models

The empty editor, the empty library and the tour's last step offer three samples (#99). Each one opens as a new, unsaved model, and each is driven by parameters, so the first change can be a number in the Parameters panel.

| Sample | Parameters | Prints |
| --- | --- | --- |
| Box with a lid | width, depth, height, wall, gap | Two parts side by side. The lid prints upside down; its lip leaves a 0.3 mm gap to each wall. |
| Bracket | width, leg, thickness, hole | One part, standing on its base. 4.5 mm holes clear M4 screws. |
| Phone stand | width, height, lean, shelf, base | One part, flat on the bed. The slope faces up, so it needs no supports. `lean` equal to `height` is 45°. |

## Changing them

The samples are code: `packages/kernel/src/samples.ts` builds each one from the document API. To change one, or after a change to the file format:

```sh
npm run build:samples -w web
```

This writes `web/public/samples/<id>.bcad` and `<id>.png`. It makes a gallery build and opens each sample in headless Chromium for the thumbnail. Add `-- --no-thumbnails` to write only the files. Commit what it writes.

`packages/kernel/src/samples.test.ts` builds every sample in the kernel. It checks that no step fails, each builds in under 2 s, the volumes are right, and a parameter change reshapes the model. So the samples are regression fixtures too.

Before launch, Kev prints the phone stand once to check that it prints with no supports.

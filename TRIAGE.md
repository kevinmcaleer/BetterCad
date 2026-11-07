# Weekly triage

Fifteen minutes, once a week (Monday works: the Triage workflow marks quiet issues inactive on Monday mornings).

1. **Open the saved search** for issues nobody has looked at:
   [is:open is:issue label:needs-triage](https://github.com/kevinmcaleer/BetterCad/issues?q=is%3Aopen+is%3Aissue+label%3Aneeds-triage).
   Also glance at [anything with no label](https://github.com/kevinmcaleer/BetterCad/issues?q=is%3Aopen+is%3Aissue+no%3Alabel).
2. **Label each one**: `bug`, `feature request` or `question`. Add `needs-model` when a bug needs a `.bcad` to
   reproduce, and `good first issue` when it is small and well described. Remove `needs-triage`.
3. **Reply within the week**, in the brand book's voice: short, second person, no exclamation marks. Say what happens
   next, even if that's "not for v1".
4. **Close duplicates** with a link to the original: "Same as #N, so I'm closing this one. Follow along there."
5. **Accepted features** get the `v2` label, or go under the epic they belong to as a sub-issue.
6. **Reports from the app**: check `DATA_DIR/reports/` (or the reports repository) for anything that didn't become an
   issue, and file the real bugs.

The Triage workflow never closes anything. Issues quiet for 90 days are marked `inactive` with a note, except bugs
with a `.bcad` attached, which stay live because they can always be reproduced.

Questions that would help others go to the kevsrobots Discord's `#bettercad` channel, or into the course.

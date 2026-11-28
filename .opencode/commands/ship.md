---
description: Ship the planned Trellis work to one draft PR
agent: shipper
---
Load the `ship` skill and run it now.

Resolve the active task and its children, print the ship plan, then run the full flow without
approval stops: worktree implementation, integration merges, gates, fallow-fix, changelog,
code review, task archive/journal, and one draft PR.

Stop only on a condition in the skill's stop table. Report the branch, PR URL, gates, proofs,
changelog entries, review outcome and residual risks.

Additional instructions: $ARGUMENTS

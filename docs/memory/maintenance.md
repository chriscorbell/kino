# Bounded review

Read when Finish reaches step 4, when a category index crosses its threshold, or when the user asks for a memory review. Each entry is a bounded pass; nothing here installs or implies a scheduler.

## Entry

| Trigger | Scope |
| --- | --- |
| Finish step 4 after a substantive task | Ordinary review, once per session; skipped by a branch-isolated writer (see [concurrency](concurrency.md)) |
| A category index would exceed its threshold | Ordinary review, with that category first in the sample |
| A user request, or a substantial unresolved conflict between notes | Dedicated review with an explicit scope |

## Ordinary review

Sample up to three active notes beyond those the task already reconciled. Choose them by a stable rotation through `context/`, `lessons/`, and `work/`: continue after the cursor saved in [the index](README.md), skip entries that no longer exist, wrap at the end.

For each sampled note make at most one direct source read or one short read-only query. Apply whichever disposition that evidence supports. When the lookup shows a contradiction but not its correction, mark the claim uncertain with a concrete next action. When verification merely exceeds the bound, leave the note and its date unchanged and record it as deferred. Advance the cursor past every attempted note. Reaching the bound alone creates no work note. This bound covers incidental sampling only; verification the user's task depends on is done in full.

**Threshold.** Each topic category starts with a threshold of 12 index entries. When the category still exceeds it after the review, set its next threshold to the next multiple of 12 above its active count and record that in the category README. This schedules another review; it does not certify the category.

## Dispositions

| Finding | Disposition |
| --- | --- |
| Still useful and supported | Retain; refresh the verification date only for claims actually checked |
| Useful but inaccurate | Correct from current evidence |
| Duplicates another note | Merge unique evidence into the canonical note, then retire the duplicate |
| Completed work or obsolete guidance with historical value | Archive with its reason and any replacement pointer |
| No remaining actionable or historical value | Remove after the recovery rule in the protocol |
| Evidence insufficient or in conflict with intent | Mark uncertain with the next concrete verification action |

Age alone establishes neither obsolescence nor correctness. Preserve accepted decisions and their rationale when implementation has drifted; record the discrepancy instead. When a task exposes stale `AGENTS.md` content, apply the delegated repairs in [document maintenance](documents.md); anything else becomes a proposal.

## Record

After a review, replace the review record in the index: date, each attempted path with its outcome (checked, deferred, or the disposition applied), and the next cursor. Link an unresolved finding to the note that records it. Review is complete when every sampled note has an outcome, affected links resolve, retirements met the recovery rule, and the record states the actual scope.

## Check the effect

For a corrected procedural lesson, replay a representative task when practical and safe. Confirm the pointer retrieves the fact and the correction fixes the original failure. State what was actually verified; this sits outside the sample's effort bound.

## Audit

To judge whether the system is working rather than silently rotting:

- List verification fields and compare dates by eye: `rg -n '^(Verified|Review after):' docs/memory/context docs/memory/lessons`.
- Compare the files in `work/` with the work index; reconcile omissions before retiring anything.
- Check that every link in the index and category indexes resolves.
- Inspect the latest three substantive task diffs and compare their documentation consequences with the documentation edits actually made.

Report mismatches and the scope reviewed. A review record is a claim about maintenance, not proof of it.

## Shared memory

A shared team or organization store needs explicit configuration, access rules, and a publication path. Treat a linked store as read-only unless write authority exists; record a proposed shared correction locally with its evidence. Read only sources the task's audience allows.

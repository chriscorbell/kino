# Memory notes

Short Markdown notes organized by topic. Start with a title and a retrieval cue that says when the note matters. Keep only applicable fields; the examples below describe the format, not facts about this workspace.

## Context and lessons

```markdown
# Descriptive topic

Read when: the concrete task or symptom this note helps with.
Status: verified | provisional | disputed | superseded
Scope: workspace, component, environment, or audience
Verified: YYYY-MM-DD, or "unverified" for a provisional finding
Source: relative source link, commit/issue reference, or dated user instruction
Recheck when: the concrete code, configuration, dependency, or decision change that would invalidate this
Review after: YYYY-MM-DD

The finding, its reason, and the action it changes.
```

`Recheck when` is required for a claim whose validity depends on mutable code, configuration, dependencies, or decisions, and names the concrete change; a stable finding omits it. `Review after` is optional, for a time-sensitive fact; a passed date triggers verification, never deletion. `Verified` changes only after the claim was checked against its source. Link evidence another session can reach; when evidence exists only in the current conversation, summarize the observation with its date, label that limitation, and give a reproducible check where possible. Invent no source URLs, revisions, measurements, or dates.

A lesson records the symptom, cause, attempted approach, working correction, and how it was verified. Record a failed approach only when its reason for failure will matter again. Keep a hypothesis provisional until checked.

## Unfinished work

Name each file `YYYY-MM-DD-topic-unique-suffix.md` and reuse it while the task continues. Include:

- The objective and current status: active, blocked, or complete.
- The branch or worktree and relevant revision, when applicable.
- Links to the authoritative issue, plan, artifacts, and relevant memory.
- What changed, what was checked, and what remains unverified.
- The next concrete action and any actual blocker.
- `Close when:` the condition that completes the work, where the linked issue or plan does not already establish it.

Capture enough to resume without the conversation; link to the plan instead of copying it. Blocked work stays active while its objective stands. Completed work belongs in the archive only if it has continuing historical value.

A **proposal** for an instruction-file change is a work note named `agents-md-proposal-<topic>` with the target section, the exact replacement, evidence, the authority needed, and the next action.

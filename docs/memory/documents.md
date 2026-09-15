# Document maintenance

Read when a change or finding may belong in a document other than the one being edited, and when `AGENTS.md` looks stale.

## Ownership

Ownership follows what the information is, never who reads it. Preserve any configured alternative to these defaults.

| Information | Owner |
| --- | --- |
| Setup, commands, usage, public behavior | `README.md` and existing human guides |
| Guides and reference for humans | `docs/`, excluding `docs/memory/` and `docs/adr/` |
| Domain vocabulary | Root `CONTEXT.md` |
| Architectural decisions and their rationale | `docs/adr/` |
| Skill configuration | `docs/agents/` (`domain.md`, `issue-tracker.md`, `triage-labels.md`) |
| Specs, tickets, plans, discovery | The task's issue or [Kino board](https://cardboard.xode.cc/b/kino), or `.scratch/<feature>/` for local work |
| Research | `docs/research/` |
| Session handoffs | The OS temporary directory; memory keeps only continuation facts in `work/` |
| Hidden constraints, expensive findings, lessons, unfinished work | `docs/memory/` |

Memory holds links and what no owner above already records. A fact found by one file read or one command stays in the environment; memory gets a pointer when the lookup is expensive.

## When a change owes a documentation edit

| Change or finding | Action |
| --- | --- |
| Setup commands, configuration, public interfaces, user workflows, deployment, or operational behavior changed | Update the affected documentation and examples in the same change |
| A documented instruction fails or contradicts verified behavior | Correct it within the task's authority, or record the specific discrepancy as unresolved |
| A usable project lacks the instruction needed to perform the task | Add the smallest useful README section or guide, written from verified behavior |
| Internal implementation changed without affecting documented behavior | Leave human documentation unchanged |
| An expensive discovery changes how future agents should work | Write it in its owner from the table above, or in memory |

Documentation is complete when every affected instruction and example matches the verified result, or a specific unresolved discrepancy is recorded. Create a README from what the workspace shows, at the size the trigger requires.

## Instruction files

`AGENTS.md` and `CLAUDE.md` govern every session. These repairs are delegated and need no further approval:

- Repair a pointer or link after verifying its target moved, preserving the instruction's meaning.
- Consolidate duplicate memory sections, preserving every unique instruction.
- Maintain a section the user has explicitly designated as agent-maintained. The memory section itself is not one.

A change to requirements, permissions, workflow obligations, accepted decisions, or maintenance authority uses authorization the user already gave, or becomes a **proposal**: a work note named `agents-md-proposal-<topic>` with the target section, the exact replacement, evidence, the authority needed, and the next action. A command missing from the environment is a proposal, because absence can mean broken setup rather than a changed requirement. Keep `CLAUDE.md` a relative symlink to `AGENTS.md`.

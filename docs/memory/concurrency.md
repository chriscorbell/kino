# Concurrent writers

Read when more than one agent may write memory at the same time.

Use a separate work note per task, named with a date, descriptive slug, and collision-resistant suffix. For shared topic notes and indexes, coordinate one writer per file. Before writing, compare the file's current content or SHA-256 hash with the version used to draft the change, then apply a narrow edit. If the file changed, reread, merge the latest content, and retry. Recheck the resulting diff.

A hash check followed by a write is not an atomic lock. When exclusive ownership cannot be established, save the proposed change in a unique work note for the next bounded review instead of racing to replace the shared file. Use existing locking or transactional storage if the workspace provides it; these Markdown instructions alone enforce nothing.

Before resuming another writer's work note, verify that the branch, files, and issue state still match it. Search `work/` for notes that a concurrent writer has not yet indexed.

## Branch-isolated writers

An agent that works on its own branch and hands the result over as a pull request never collides while writing; it collides at merge time, on whichever file every branch rewrites. In this system that file is the index [README.md](README.md): its review record and canonical-documents list are replaced by every bounded review, so two branches that each ran one conflict with certainty. A branch-isolated writer therefore:

- adds or updates topic notes and its own work note, and adds one bullet to the category index for a new note;
- leaves the root index untouched and skips the bounded review;
- keeps proposals for instruction files as work notes, as usual.

Category indexes still conflict when two branches each add a bullet; both bullets are kept. Interactive sessions that write on the default branch own the root index and run the bounded review for everyone.

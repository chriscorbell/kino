# A probe kills only the process it started

Read when: looping a desktop probe, running Kino under a debugger or a wrapper script, or memory runs low after native checks.
Status: verified
Scope: desktop probes on the Mac and in the Flatpak, and cleanup commands anywhere
Verified: 2026-10-21
Source: `docs/memory/work/2026-09-25-full-featured-plan-k7q.md` "Traps found on 2026-09-26"; `scripts/test-support/kino-flatpak.sh`; `docs/validation/linux-hardware.md`; the mbp auto-memory note on probe loops, 2026-09-26

A probe stops the child it started, and anything that child started can outlive it. On 2026-09-26 a 40-run loop of the interface recovery probe started Kino under `lldb --batch` through a wrapper script; each run's kill reached the wrapper, and an orphaned lldb of about 4 GB stayed behind with its Kino, which nearly ran the Mac out of memory. In the Flatpak, the desktop portal's WebEngine sandboxes outlive a killed Kino; `kino-flatpak.sh` keeps a probe from hanging on their stderr, but they still need clearing between probes. A cleanup written as `pkill -f PATTERN` inside a compound or SSH command matches its own shell's command line and kills it. After any loop or native probe, list what is left by process name with `ps -axo pid=,rss=,comm=` and check memory, then stop the leftover Kino, lldb or sandbox processes by pid. To match by pattern, bracket it (`[n]ode scripts`) and run the cleanup as a command of its own. The lldb figure is from the mbp memory note and the work note; checked on 2026-10-21 that both cleanup traps are still recorded and that the Flatpak wrapper still routes stderr through a file.

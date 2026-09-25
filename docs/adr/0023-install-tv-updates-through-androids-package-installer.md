# Install TV updates through Android's package installer

## Status

Accepted

## Context

The product contract had Kino check for releases once a day, prompt when one exists, and never install silently. The desktop meets that by handing the release page to the system browser. The contract asked the TV to do the same for sideloaded builds, but an Android TV has no browser a remote can use to fetch an APK. Updating by hand means another computer, `adb`, or a file manager, which is how the Shield has been updated so far.

Android offers a way for an app to update itself that still leaves the decision with the viewer. The app hands an APK to the package installer, and the installer shows its own confirmation. Android only installs an update signed with the certificate the installed app carries.

## Decision

On the TV, the update notice's Install downloads the release's APK and `SHA256SUMS`. It checks the APK before Android sees it, then hands it to Android's package installer, which asks the viewer to confirm.

- The check follows the desktop's rules: the same feed, channel choice, daily limit, Remind me tomorrow, and Skip this version.
- Download addresses are built from the validated tag and the Release workflow's fixed asset names. Nothing in the GitHub response becomes a URL Kino fetches.
- Kino refuses an APK whose SHA-256 is not the one `SHA256SUMS` lists for its name. It also refuses one that is not `app.kino.tv`, is not a higher version code than the installed app, or is not signed with the installed app's certificate. The last case would fail in Android's installer anyway, but only after the viewer confirmed, and without saying why.
- On Android 12 and later, Kino asks the installer to require the viewer's confirmation explicitly, since an app updating itself could otherwise skip it. Kino never installs without that confirmation.
- Allowing Kino to install apps is Android's own setting. Android ends Kino's process when that permission changes, so Kino remembers the chosen release and offers it again on the next launch.

The desktop keeps handing the release page to the browser.

## Consequences

The TV app declares `REQUEST_INSTALL_PACKAGES`. It reaches `github.com` and GitHub's download host for release assets, as well as the releases API it already used for the check. No identifier is sent.

A development build is signed with its machine's debug key, so a published release fails the signer check on it and the notice says so. Every release installs over the last only once releases are signed with the pinned release key.

`UpdateTest` on the Shield checks the version order and channel rules against the desktop's cases, and a download served from memory, including the exact GitHub addresses. It checks each refusal: checksum, package, version, and signer. The signer case uses a copy of the build that `pnpm android:check` re-signs with a throwaway key. It also hands a build to Android's installer, confirms the prompt appears, and cancels it with Back. Finally it checks the notice's Skip, Remind me tomorrow, daily limit, and resumed-after-permission paths.

#!/usr/bin/env bash
#
# Sets up the key that signs Kino's official TV releases. Run it once, by hand; it is the only
# step of the release pipeline that holds a secret.
#
# It chooses or creates the keystore, stores it and its passwords as GitHub Actions secrets for
# the Release workflow, and pins the certificate's SHA-256 in
# apps/android-tv/release-certificate.sha256, which the workflow checks every release against.
#
# Android installs an update only over an app signed with the same certificate, so this key must
# never change and must never be lost. Keep the keystore and its passwords in a password manager.

set -euo pipefail

kino_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kino_pin="${kino_repo_root}/apps/android-tv/release-certificate.sha256"
kino_repository="chriscorbell/kino"

command -v gh >/dev/null || { echo "The GitHub CLI is required: brew install gh" >&2; exit 1; }
command -v keytool >/dev/null || { echo "keytool is required: brew install openjdk@21" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login" >&2; exit 1; }

cat <<'TEXT'

Which key should sign Kino's TV releases?

  1) This Mac's development key (~/.android/debug.keystore)
     The TV app already installed from this Mac updates in place and keeps its data,
     and local development builds keep installing over releases.

  2) A new key made just for releases
     Cleaner separation, but a TV with a development build must uninstall it once
     and sign in again before the first release installs.

TEXT
read -r -p "Choose 1 or 2: " kino_choice

case "${kino_choice}" in
  1)
    kino_keystore="${HOME}/.android/debug.keystore"
    [[ -f "${kino_keystore}" ]] || { echo "No development key at ${kino_keystore}" >&2; exit 1; }
    kino_store_password="android"
    kino_alias="androiddebugkey"
    kino_key_password="android"
    echo
    echo "The development key's passwords are Android's public defaults; the keystore file itself"
    echo "is what must stay private. It will be uploaded to GitHub as an encrypted secret."
    ;;
  2)
    kino_keystore="${HOME}/.config/kino/android-release.jks"
    if [[ -e "${kino_keystore}" ]]; then
      echo "A release key already exists at ${kino_keystore}; using it."
      read -r -s -p "Its store password: " kino_store_password; echo
    else
      mkdir -p "$(dirname "${kino_keystore}")"
      kino_store_password="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
      keytool -genkeypair -keystore "${kino_keystore}" -storetype PKCS12 \
        -storepass "${kino_store_password}" -alias kino-release \
        -keyalg RSA -keysize 4096 -validity 36500 \
        -dname "CN=Kino, O=Kino" >/dev/null
      chmod 600 "${kino_keystore}"
      echo
      echo "Created ${kino_keystore}."
      echo "Store password (save it in your password manager now): ${kino_store_password}"
    fi
    kino_alias="kino-release"
    # PKCS12 keys share the store password.
    kino_key_password="${kino_store_password}"
    ;;
  *)
    echo "Nothing changed." >&2
    exit 1
    ;;
esac

kino_fingerprint="$(keytool -list -v -keystore "${kino_keystore}" -storepass "${kino_store_password}" \
  -alias "${kino_alias}" | sed -n 's/^[[:space:]]*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f')"
[[ ${#kino_fingerprint} -eq 64 ]] || { echo "Could not read the certificate fingerprint." >&2; exit 1; }

echo
echo "Certificate SHA-256: ${kino_fingerprint}"
read -r -p "Upload this key as Release workflow secrets on ${kino_repository}? [y/N] " kino_confirm
[[ "${kino_confirm}" == [yY] ]] || { echo "Nothing uploaded." >&2; exit 1; }

base64 < "${kino_keystore}" | gh secret set KINO_ANDROID_KEYSTORE_BASE64 --repo "${kino_repository}"
printf '%s' "${kino_store_password}" | gh secret set KINO_ANDROID_KEYSTORE_PASSWORD --repo "${kino_repository}"
printf '%s' "${kino_alias}" | gh secret set KINO_ANDROID_KEY_ALIAS --repo "${kino_repository}"
printf '%s' "${kino_key_password}" | gh secret set KINO_ANDROID_KEY_PASSWORD --repo "${kino_repository}"
printf '%s\n' "${kino_fingerprint}" > "${kino_pin}"

echo
echo "Secrets uploaded, and ${kino_pin#"${kino_repo_root}/"} now pins the certificate."
echo "Commit that file; the Release workflow refuses any APK signed with another key."

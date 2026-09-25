# Send add-on addresses from a phone

## Status

Accepted

## Context

Version one allows add-on configuration, removal, and manual manifest installation on every client. An add-on is configured on its own settings page, which it serves as `configure` beside its manifest. The page ends with an install address that carries the chosen settings, often a few hundred characters of base64. The desktop opens the page in the system browser and takes the address back in a paste field.

The TV has no browser to open the page in, and typing an address that long with a remote is not a realistic request. Stremio's own answer, installing on another device signed in to the same account and letting the add-on sync, leaves guests out and depends on a Stremio app on that device. Kino operates no service that could relay an address between a phone and a TV.

## Decision

While an add-on dialog is open on the TV, Kino serves a small page on the home network and shows its address as a QR code and as text. A phone on the same network opens it, follows its link to the add-on's settings page when configuring, and sends the resulting address back to the TV. The TV then loads that add-on and asks for confirmation, as it does for a typed address.

- The page listens only on a private IPv4 address of a running Ethernet or Wi-Fi interface, and only while the dialog is open. A TV without such an address offers typing alone.
- The page's address carries a random 128-bit token. Any other path answers 404.
- The page accepts one form field, and only an address that the typed path would also accept: HTTPS, ending in `manifest.json`, without credentials, or a `stremio://` link to one.
- The page carries no script. Its responses forbid caching and referrers, so the token does not leave in a `Referer` header when the phone follows the link to the add-on's settings.
- Logs name the page's events only. Addresses, tokens, and network addresses stay out of them.
- A new configuration of an installed add-on replaces it. Kino removes the old configuration only after Core holds the new one, and only when both have the same add-on id, so a failed install never loses a working configuration.
- An add-on whose manifest says it must be configured goes to its settings page first, rather than to an install that Core would refuse.

## Consequences

Configuring an add-on on the TV takes a phone on the same network, and the settings page must offer its install address in a form the phone can copy. Most do; one that only offers a `stremio://` button leaves the viewer to copy the link from it.

The TV runs a listening socket on the home network for as long as the dialog is open. Anyone on that network who learns the token could send an address, but nothing installs without the viewer confirming it on the TV.

The QR code comes from Project Nayuki's QR Code generator, a small MIT-licensed library with no dependencies of its own, which the Android notices review covers.

`AddonConfigurationTest` on the Shield plays the phone over the Shield's own network address. It checks the page's link to the settings page, the refusal of a wrong token and of an address that is not an add-on, the replacement of the old configuration after confirmation on the TV, the page closing with its dialog, and that an add-on that needs settings is configured before it installs.

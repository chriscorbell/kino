# Separate guest and account state

Guest library and playback progress remain device-local and separate from signed-in Stremio account state. Signing in loads the account state without silently importing, merging, or overwriting guest data. Signing out makes the preserved guest profile available again.

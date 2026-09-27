# Fonts

The shipped app uses **Satoshi** (Fontshare) and **Exposure** (a commercial
display serif). Their licenses do not allow redistribution, so this folder holds
**free placeholders under the same file names**, so the project builds as-is:

| File | Placeholder | License |
|---|---|---|
| `Satoshi-Regular/Medium/Bold.otf` | Manrope 400/500/700 | SIL OFL 1.1 (`OFL-Manrope.txt`) |
| `ExposureTrial-0.otf` | DM Serif Display | SIL OFL 1.1 (`OFL-DMSerifDisplay.txt`) |

To get the original look, drop the real files over these ones:
Satoshi is free from https://www.fontshare.com/fonts/satoshi.

Text styled with the `Satoshi-*` family names falls back to the iOS system font
when the placeholders are used; everything else works the same.

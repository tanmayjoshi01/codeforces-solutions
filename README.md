# CF2GitHub

CF2GitHub is a Chrome Manifest V3 extension that automatically saves accepted
Codeforces solutions to a GitHub repository.

It is built with plain JavaScript, CSS, and HTML. No external libraries or
CDNs are required.

## Features

- Detects accepted Codeforces submissions.
- Pushes solution files to GitHub automatically or manually.
- Uses GitHub OAuth Device Flow for sign-in.
- Lets you choose a repository from your GitHub repositories.
- Uses the selected repository's default branch.
- Creates a separate folder for each problem.
- Optionally creates a README for every solution.
- Stores dashboard history with streaks, totals, recent solves, tags, badges,
  and Codeforces profile information.
- Supports light and dark browser themes.
- Respects reduced-motion accessibility preferences.

## Requirements

- Google Chrome or another Chromium-based browser with Manifest V3 support.
- A Codeforces account.
- A GitHub account.
- A GitHub repository where you can write contents.

## Install from source

1. Download or clone this project.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `cf2github` folder containing `manifest.json`.
6. Pin CF2GitHub from the browser's Extensions menu if desired.

When you edit the extension files, return to `chrome://extensions` and click
the extension's **Reload** button.

## First-time setup

1. Open the CF2GitHub popup.
2. Click **Login with GitHub**.
3. Copy the displayed device code.
4. Complete the authorization on GitHub in the tab that opens.
5. Return to the popup.
6. Select the repository where solutions should be stored.
7. Optionally enter your Codeforces handle to show your current rating and
   rank.
8. Configure the options:
   - **Folder**: the top-level folder for solutions. Defaults to `CODEFORCES`.
   - **Auto-push on Accepted**: pushes newly accepted submissions automatically.
   - **Include README**: creates a problem README beside each solution.

The selected repository's default branch is detected and saved automatically.

## GitHub permissions

The OAuth login requests access needed to write solution files to the
repository you select. Only choose a repository you trust this extension to
modify.

The access token is stored in Chrome's local extension storage. Repository
settings and dashboard preferences use Chrome sync storage.

If GitHub reports that the token cannot write to a repository, select another
repository or update the GitHub authorization.

## How pushing works

Open a Codeforces submissions or contest status page while using the
extension. When a submission reaches the `OK` verdict:

- With auto-push enabled, CF2GitHub sends it to the selected GitHub repository.
- With auto-push disabled, an accepted submission can be pushed using the
  **Push to GitHub** action shown by the extension.
- Duplicate submissions are skipped.
- A successful push briefly shows a gold star badge on the extension icon.
- A failed push shows a red `!` badge until the popup is opened.

The default solution path is:

```text
CODEFORCES/{contestId}{index} - {name}/solution.<extension>
```

For example:

```text
CODEFORCES/339A - Helpful Maths/solution.cpp
```

The commit message format is:

```text
Add {contestId}{index} - {name}
```

Folder names and file names are sanitized before they are sent to GitHub.

## README files for solutions

When **Include README** is enabled, each problem folder can contain a README
with:

- Problem title and Codeforces link.
- Problem rating and tags when available.
- Problem statement and examples when Codeforces allows them to be fetched.
- Submission language and other metadata.

If Codeforces blocks the problem page, the solution is still uploaded and a
basic README is generated.

## Dashboard

The popup dashboard displays:

- Current and best streak.
- Last seven days of activity.
- Total solved and this-week counts.
- Difficulty distribution.
- Recent solves.
- Top tags when available.
- Achievement badges.
- Codeforces rating, rank, and peak rating when a handle is configured.

History is saved locally in the extension and is capped at the latest 5,000
records.

## Disconnecting

Open Settings and click **Disconnect** or **Log out**. Confirm the action to
remove the saved GitHub token and selected repository from the extension.

## Troubleshooting

### The popup says that GitHub login expired

Log in again from Settings. A revoked or expired authorization token is
removed automatically.

### A repository is missing from the picker

Check that the GitHub account can access the repository. Organization
repositories may also require approval for the OAuth application.

### A submission is not pushed

Check the following:

1. Auto-push is enabled, or use the manual **Push to GitHub** action.
2. The Codeforces page is open and the submission has an `OK` verdict.
3. A repository has been selected in Settings.
4. The selected repository allows content writes.
5. The browser has an active internet connection.

### Codeforces returns `403 Forbidden`

Open the submission page directly in Codeforces and refresh it. Codeforces
may temporarily restrict automated requests or require the page to be loaded
from an authenticated session.

### View extension errors

1. Open `chrome://extensions`.
2. Find CF2GitHub.
3. Click the **service worker** link to inspect background errors.
4. Open DevTools for the Codeforces tab to inspect content-script messages.
5. Open DevTools for the popup to inspect dashboard or settings errors.

Content-script messages use the `[CF2GitHub]` prefix.

## Permissions used

The extension requests:

- `storage`: save configuration, login state, and dashboard history.
- `notifications`: notify you when a push succeeds or fails.
- `alarms`: continue OAuth Device Flow polling if the popup closes.
- Codeforces host access: inspect submission and problem pages.
- GitHub API access: authenticate, list repositories, and upload files.

## Project files

- `manifest.json`: Chrome extension metadata and permissions.
- `popup.html`: dashboard and Settings markup.
- `popup.css`: dashboard, Settings, theme, and animation styles.
- `popup.js`: popup interaction and dashboard rendering.
- `content.js`: Codeforces page detection and submission extraction.
- `background.js`: GitHub API calls, OAuth polling, and push processing.
- `utils.js`: shared settings, parsing, templates, and helper functions.

## License

Add your project license and contribution guidelines here.

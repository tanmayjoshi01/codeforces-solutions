# CF2GitHub

CF2GitHub is a plain JavaScript Chrome Manifest V3 extension that pushes newly accepted Codeforces submissions to a GitHub repository.

## Setup

1. Create an empty GitHub repository (a private repository works).
2. Create a fine-grained personal access token at [GitHub token settings](https://github.com/settings/personal-tokens/new). Give it access to the repository and **Contents: Read and write** permission. Never share the token.
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this `cf2github` folder.
4. Open the CF2GitHub popup, choose **Login with GitHub**, approve the device-flow request, and select a repository. The token is stored only in Chrome local storage; branch and other optional behavior are available under **Advanced**.

## Usage

Open a Codeforces submissions or contest status page. When a submission observed in a waiting/non-accepted state changes to `OK`, it is pushed automatically if auto-push is enabled. Existing accepted rows get a **Push to GitHub** button for manual pushing. OAuth uses GitHub's device flow; a manual repository URL and fine-grained token remain available under **Advanced**. Other settings sync through Chrome storage sync.

The default layout is `{folder}/{contestId}{index} - {name}/solution.<extension>`, with `CODEFORCES` as the default folder. Folder template values are sanitized individually, so template separators such as `/` remain path separators. Supported placeholders include `{folder}`, `{contestId}`, `{index}`, `{name}`, and `{language}`; unknown placeholders become empty. Existing saved templates continue to work.

Each README includes the problem title and link, rating/tags when available, the converted Codeforces statement (including examples), and a submission metadata table. If Codeforces blocks the problem page, the code still uploads and a basic README is written.

## Debugging

Use the extension card's **service worker** link on `chrome://extensions` to inspect background logs and errors. Inspect the Codeforces tab's DevTools console for content-script logs prefixed with `[CF2GitHub]`. The popup's DevTools can be opened by right-clicking the popup.

## Known limitations

Codeforces markup can change, and verdict detection relies on `span.submissionVerdictWrapper` attributes. Tags and ratings may be unavailable during live contests. GitHub API conflicts are retried once; the root repository index is intentionally not maintained in this MVP.

<!-- TODO: add an optional root-level README index table in a future version. -->

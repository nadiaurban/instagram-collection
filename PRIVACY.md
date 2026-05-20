# Privacy Policy — Instagram Collector

_Last updated: May 2026_

## What this extension does

Instagram Collector is a research tool that captures Instagram posts and comments
as you browse, and lets you export them as NDJSON files for offline analysis.
Collection is **opt-in**: nothing is recorded unless you press Start in the popup.

## What data is collected

When collection is active, the extension reads Instagram API responses that your
browser has already loaded and extracts structured fields from them, including:

- Post metadata: post ID, URL, caption, media type, publication date
- Engagement counts: likes, comments, views
- Author information: username, display name, verification status
- AI label fields: whether Instagram has flagged content as AI-generated
- Comment text, author, and timestamp (when you visit a post's comments)

## How data is stored

All data is stored **locally in your browser** using `browser.storage.local`.
Nothing is sent to any external server. The extension has no backend and makes
no outbound network requests of its own.

When you export, the data is written to a file on your own device. What you do
with that file is your responsibility.

## What data is not collected

- Passwords, login tokens, or session cookies
- Direct messages or private account content
- Any data from pages other than instagram.com
- Any data while collection is paused or stopped

## Third parties

This extension does not share data with any third party. It has no analytics,
no crash reporting, and no telemetry.

## Contact

This extension was developed for academic research. For questions, open an issue
at [github.com/nadiaurban/instagram-collection](https://github.com/nadiaurban/instagram-collection).

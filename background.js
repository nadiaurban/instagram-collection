// background.js
// Intercepts Instagram network responses and comment API calls.
// Stores posts and comments separately. Exports as NDJSON.

// ── State ─────────────────────────────────────────────────────────────────────

let posts = {};               // keyed by media_id — deduplicates automatically
let comments = {};            // keyed by comment_id
let collecting = false;       // must be explicitly started — paused by default
let session_started_at = null;

// ── URL patterns ─────────────────────────────────────────────────────────────

const POST_URL_PATTERN = "*://*.instagram.com/*";
const COMMENT_PATTERNS = [
    "*://www.instagram.com/api/v1/media/*/comments/",
    "*://www.instagram.com/api/v1/media/*/comments/?*"
];

// ── Intercept ALL instagram responses (for post capture) ──────────────────────

browser.webRequest.onBeforeRequest.addListener(
    function(details) {
        if (!collecting) return {};
        if (!["xmlhttprequest", "main_frame", "sub_frame"].includes(details.type)) return {};

        const filter = browser.webRequest.filterResponseData(details.requestId);
        const decoder = new TextDecoder("utf-8");
        let responseText = "";

        filter.ondata = event => {
            responseText += decoder.decode(event.data, { stream: true });
            filter.write(event.data);
        };

        filter.onstop = () => {
            filter.close();
            if (details.url.includes('/comments/')) return;

            try {
                const captured = captureInstagramPosts(
                    responseText,
                    details.documentUrl || details.url,
                    details.url
                );

                if (captured.length > 0) {
                    let newCount = 0;
                    for (const post of captured) {
                        if (!post.media_id) continue;
                        const existing = posts[post.media_id];
                        if (!existing || (existing.is_partial && !post.is_partial)) {
                            posts[post.media_id] = post;
                            newCount++;
                        }
                    }
                    if (newCount > 0) {
                        persist();
                        broadcastStats();
                    }
                }
            } catch(e) {}
        };

        return {};
    },
    { urls: [POST_URL_PATTERN] },
    ["blocking"]
);

// ── Intercept comment responses ───────────────────────────────────────────────

browser.webRequest.onBeforeRequest.addListener(
    function(details) {
        if (!collecting) return {};

        const filter = browser.webRequest.filterResponseData(details.requestId);
        const decoder = new TextDecoder("utf-8");
        let responseText = "";

        filter.ondata = event => {
            responseText += decoder.decode(event.data, { stream: true });
            filter.write(event.data);
        };

        filter.onstop = () => {
            filter.close();
            try {
                const data = JSON.parse(responseText);
                parseComments(data, details.url);
            } catch(e) {}
        };

        return {};
    },
    { urls: COMMENT_PATTERNS },
    ["blocking"]
);

// ── Comment parser ────────────────────────────────────────────────────────────

function parseComments(data, url) {
    const mediaIdMatch = url.match(/\/media\/(\d+)\/comments/);
    const media_id = mediaIdMatch ? mediaIdMatch[1] : null;

    const rawComments = data.comments || [];
    if (rawComments.length === 0) return;

    const collected_at = Date.now();
    let newCount = 0;

    for (const c of rawComments) {
        const comment_id = c.pk || c.id;
        if (!comment_id || comments[comment_id]) continue;

        comments[comment_id] = {
            comment_id:          comment_id,
            media_id:            media_id,
            text:                c.text || null,
            created_at:          c.created_at || null,
            like_count:          c.comment_like_count || 0,
            child_comment_count: c.child_comment_count || 0,
            username:            c.user?.username || null,
            user_id:             c.user?.pk || null,
            is_verified:         c.user?.is_verified || false,
            is_private:          c.user?.is_private || false,
            collected_at:        collected_at,
        };
        newCount++;
    }

    if (newCount > 0) {
        persist();
        broadcastStats();
    }
}

// ── Persist to storage ────────────────────────────────────────────────────────

function persist() {
    browser.storage.local.set({ posts, comments, collecting, session_started_at });
}

// ── Broadcast stats to popup if open ─────────────────────────────────────────

function broadcastStats() {
    browser.runtime.sendMessage({
        type:              "statsUpdate",
        posts:             Object.keys(posts).length,
        comments:          Object.keys(comments).length,
        collecting:        collecting,
        session_started_at: session_started_at,
    }).catch(() => {});
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportNDJSON(type) {
    const data = type === "posts"
        ? Object.values(posts)
        : Object.values(comments);

    if (data.length === 0) return;

    const ndjson = data.map(r => JSON.stringify(r)).join("\n");
    const blob = new Blob([ndjson], { type: "application/x-ndjson" });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().replace(/[:.]/g, "-");

    browser.downloads.download({
        url,
        filename: `instagram-${type}-${ts}.ndjson`,
        saveAs: true
    });
}

// ── Messages from popup ───────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === "getStats") {
        sendResponse({
            posts:              Object.keys(posts).length,
            comments:           Object.keys(comments).length,
            collecting:         collecting,
            session_started_at: session_started_at,
        });
    }

    if (message.action === "startCollection") {
        // Reset data and start fresh
        posts              = {};
        comments           = {};
        collecting         = true;
        session_started_at = Date.now();
        persist();
        broadcastStats();
        sendResponse({ ok: true });
    }

    if (message.action === "stopCollection") {
        collecting = false;
        persist();
        broadcastStats();
        sendResponse({ ok: true });
    }

    if (message.action === "exportPosts")    exportNDJSON("posts");
    if (message.action === "exportComments") exportNDJSON("comments");

    if (message.action === "reset") {
        posts              = {};
        comments           = {};
        collecting         = false;
        session_started_at = null;
        browser.storage.local.set({ posts: {}, comments: {}, collecting: false, session_started_at: null });
        sendResponse({ ok: true });
    }

    return true;
});

// ── Restore session on startup ────────────────────────────────────────────────
// Restores data but NOT collecting state — always starts paused after reload

browser.storage.local.get(["posts", "comments", "session_started_at"]).then(result => {
    if (result.posts)             posts             = result.posts;
    if (result.comments)          comments          = result.comments;
    if (result.session_started_at) session_started_at = result.session_started_at;
    // collecting intentionally NOT restored — always paused on reload
});

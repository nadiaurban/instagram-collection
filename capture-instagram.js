// capture-instagram.js
// Post capture logic adapted from Zeeschuimer (digitalmethodsinitiative/zeeschuimer)
// MIT-compatible adaptation for standalone research use.
// Handles feed, explore, hashtag, user profile, single post, and reel pages.

const INSTAGRAM_DOMAIN = "instagram.com";

// ── View detection ────────────────────────────────────────────────────────────

function detectView(source_platform_url) {
    const path = new URL(source_platform_url).pathname.split('/').filter(Boolean);

    if (path.length === 0) return "frontpage";

    const ignored = ["direct", "account", "directory", "lite", "legal", "static_resources"];
    if (ignored.includes(path[0])) return null;

    if (path[0] === "explore") {
        if (path[1] === "locations") return "location";
        if (path[1] === "search") return "search";
        if (path[1] === "tags") return "hashtag";
        return "explore";
    }
    if (path[0] === "popular") return "popular";
    if (path[0] === "reels") {
        if (path.length > 1 && path[1] === "audio") return "reels_audio";
        return "reels";
    }
    if (path[0] === "stories") return null; // skip stories
    if (path[0] === "reel") return "single_reel";
    if (path[0] === "p") return "single_post";

    if (path.length === 1) return "user_posts";
    if (path[1] === "tagged") return "user_tagged";
    if (path[1] === "reels") return "user_reels";
    if (path[1] === "reposts") return "user_reposts";
    if (path[1] === "saved") return "user_saved";
    if (path[1] === "p") return "single_post";
    if (path[1] === "reel") return "single_reel";

    return "unknown";
}

// ── JSON extraction from HTML pages ──────────────────────────────────────────
// Single post/reel pages embed data in HTML rather than returning JSON API responses

function extractEmbeddedJSON(response) {
    const datas = [];
    const prefixes = [
        "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"RelayPrefetchedStreamCache\",\"next\",[],[",
        "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"PolarisQueryPreloaderCache\",\"add\",[],["
    ];

    for (const prefix of prefixes) {
        for (const line of response.split("\n")) {
            if (line.indexOf(prefix) === -1) continue;

            let json_bit = line.split(prefix.slice(0, -1))[1].split('</script>')[0].trim();
            if (json_bit.endsWith(';')) json_bit = json_bit.slice(0, -1);
            if (json_bit.indexOf('adp_PolarisDesktopPostPageRelatedMediaGrid') >= 0) continue;

            json_bit = json_bit.split(']]}}')[0];
            json_bit = json_bit.split('],["CometResourceScheduler"')[0];

            try {
                let extracted = JSON.parse(json_bit);

                // Explorer JSON is wrapped in result.response
                function unwrap(obj) {
                    for (let key in obj) {
                        if (!obj.hasOwnProperty(key)) continue;
                        if (key === "result" && obj[key] && "response" in obj[key]) {
                            try { return JSON.parse(obj[key]["response"]); } catch(e) {}
                        } else if (typeof obj[key] === "object") {
                            const res = unwrap(obj[key]);
                            if (res !== null) return res;
                        }
                    }
                    return null;
                }

                const unwrapped = unwrap(extracted);
                datas.push(unwrapped !== null ? unwrapped : extracted);
            } catch(e) {}
        }
    }
    return datas;
}

// ── Traverse JSON for media objects ──────────────────────────────────────────
// Instagram's API responses vary by endpoint; this generic traversal finds
// media items regardless of nesting structure — core insight from Zeeschuimer.

function traverseForMedia(datas, view, source_url) {
    const ITEM_LISTS = ["items", "edges", "repost_grid_items", "medias", "feed_items", "fill_items", "two_by_two_item"];
    let edges = [];

    function traverse(obj) {
        for (let property in obj) {
            if (!obj.hasOwnProperty(property)) continue;

            // Personal feed (frontpage only)
            if (property === "xdt_api__v1__feed__timeline__connection") {
                if (view !== "frontpage") continue;
                edges.push(...obj[property]["edges"]
                    .filter(e => "node" in e)
                    .map(e => e["node"])
                    .map(e => (!e['media'] && e['explore_story']?.['media']) ? e['explore_story'] : e)
                    .filter(n => n?.["media"]?.["id"] && n?.["media"]?.["user"])
                    .map(n => n["media"])
                );
                return;

            // User timeline and location pages
            } else if (["xdt_api__v1__feed__user_timeline_graphql_connection", "xdt_location_get_web_info_tab"].includes(property)) {
                edges.push(...obj[property]["edges"]
                    .filter(e => "node" in e)
                    .map(e => e["node"])
                    .filter(n => n?.["id"] && n?.["user"] && n["product_type"] !== "ad")
                );

            // Generic item lists
            } else if (ITEM_LISTS.includes(property)) {
                const val = obj[property];
                if (!val || (Array.isArray(val) && val.length === 0)) continue;

                let items = [];

                if (property === "edges" || property === "repost_grid_items") {
                    const nodes = val.map(e => e && (e.node || e));
                    const medias = nodes.map(n => n?.media || null).filter(Boolean);
                    if (medias.length > 0) {
                        items = medias;
                    } else {
                        const mediaLike = nodes.filter(n => n && 'id' in n &&
                            ('media_type' in n || ["XIGPolarisVideoMedia", "XIGPolarisImageMedia"].includes(n.__typename)));
                        items = mediaLike.length > 0 ? mediaLike : val;
                    }

                } else if (property === "medias" || property === "fill_items") {
                    if (!["explore", "search", "hashtag"].includes(view)) continue;
                    items = val.map(m => m["media"]);

                } else if (property === "feed_items") {
                    items = val.map(m => m["media_or_ad"]);

                } else if (property === "items" && val.every(i => 'media' in i)) {
                    if (!["explore"].includes(view) &&
                        !["api/v1/clips/music/", "api/v1/feed/saved/"].some(ep => source_url.includes(ep))) continue;
                    items = val.map(m => m["media"]);

                } else if (property === "two_by_two_item") {
                    items = [val['channel']['media']];

                } else {
                    items = val;
                }

                if (items) {
                    edges.push(...items.filter(item =>
                        item &&
                        "id" in item &&
                        ("media_type" in item || ["XIGPolarisVideoMedia", "XIGPolarisImageMedia"].includes(item.__typename)) &&
                        "user" in item &&
                        item["product_type"] !== "ad" &&
                        !item["link"]?.startsWith('https://www.facebook.com/ads/')
                    ));
                }

            } else if (typeof obj[property] === "object") {
                traverse(obj[property]);
            }
        }
    }

    for (const data of datas) {
        if (data) traverse(data);
    }

    return edges;
}

// ── Schema: flatten raw media object into clean research record ───────────────

function buildPostRecord(edge, view, collected_at) {
    const user = edge.user || {};
    const caption = edge.caption || {};

    // Best image URL (highest resolution candidate)
    const imgCandidates = edge.image_versions2?.candidates || [];
    const imageUrl = imgCandidates[0]?.url || null;

    // Best video URL
    const vidVersions = edge.video_versions || [];
    const videoUrl = vidVersions[0]?.url || null;

    // Carousel children image URLs
    const carouselUrls = (edge.carousel_media || []).map(item => {
        const c = item.image_versions2?.candidates || [];
        return c[0]?.url || null;
    }).filter(Boolean);

    return {
        // ── Identifiers
        media_id:           edge.id ? String(edge.id).split('_')[0] : null,
        shortcode:          edge.code || null,
        post_url:           edge.code ? `https://www.instagram.com/p/${edge.code}/` : null,

        // ── Content
        media_type:         { 1: "photo", 2: "video", 8: "carousel" }[edge.media_type] || edge.media_type || null,
        posted_at:          edge.taken_at || null,
        caption_text:       caption.text || null,
        caption_edited:     edge.caption_is_edited || false,
        accessibility_caption: edge.accessibility_caption || null,
        carousel_count:     edge.carousel_media_count || null,
        product_type:       edge.product_type || null,   // feed, reel, etc.
        location:           edge.location?.name || null,

        // ── AI label fields (core for research)
        // gen_ai_detection_method is populated on individual post pages (not feed);
        // values: "SELF_DISCLOSURE_FLOW" (creator-declared) or "C2PA_METADATA" (embedded credentials)
        ai_label:           edge.gen_ai_detection_method?.detection_method || null,
        // true = Instagram shows a prominent "Made with AI" warning (realistic depictions of real people/events)
        ai_high_risk:       edge.has_high_risk_gen_ai_inform_treatment || false,

        // ── Engagement
        like_count:         edge.like_count || 0,
        comment_count:      edge.comment_count || 0,
        view_count:         edge.view_count || edge.play_count || null,
        likes_disabled:     edge.like_and_view_counts_disabled || false,
        comments_disabled:  edge.comments_disabled || false,

        // ── Account
        username:           user.username || null,
        user_id:            user.pk || user.id || null,
        full_name:          user.full_name || null,
        is_verified:        user.is_verified || false,
        is_private:         user.is_private || false,

        // ── Commercial
        is_paid_partnership: edge.is_paid_partnership || false,
        sponsor_tags:       (edge.sponsor_tags || []).map(s => s.username).join(', ') || null,

        // ── Media URLs (for downstream download — expire within hours)
        image_url:          imageUrl,
        video_url:          videoUrl,
        carousel_urls:      carouselUrls.length > 0 ? carouselUrls.join('|') : null,

        // ── Collection metadata
        collected_at:       collected_at,
        page_view:          view,
        is_partial:         edge._zs_partial || false,
    };
}

// ── Main entry point ──────────────────────────────────────────────────────────

function captureInstagramPosts(responseText, source_platform_url, source_url) {
    const view = detectView(source_platform_url);
    if (!view) return [];

    // Skip background/logging requests
    const source_path = new URL(source_url).pathname.split('/').filter(Boolean);
    if (source_path[0] === "logging_client_events") return [];
    if (source_url.includes('injected_story_units')) return [];

    // Skip pre-cache noise (reels audio, explore loading in background)
    // Hashtag pages (/explore/tags/…) are excluded from this block — they need GraphQL through.
    if ((source_platform_url.includes('reels/audio') || (source_platform_url.includes('/explore/') && view !== "hashtag")) &&
        !source_platform_url.includes('/locations/') &&
        (source_url.endsWith('graphql') || source_url.endsWith('graphql/query'))) {
        return [];
    }

    if (source_url.includes('/api/v1/discover/web/explore_grid/') && view !== "explore") return [];

    // Parse response
    let datas = [];
    let is_json = false;

    try {
        let text = responseText;
        if (text.startsWith("for (;;);")) text = text.slice(9);
        datas.push(JSON.parse(text));
        is_json = true;
    } catch {
        try {
            datas.push(...extractEmbeddedJSON(responseText));
        } catch(e) {
            return [];
        }
    }

    if (datas.length === 0) return [];

    // Filter lightspeed background requests
    if (datas.length === 1 &&
        'lightspeed_web_request_for_igd' in datas[0] &&
        source_url.endsWith('graphql')) return [];

    const edges = traverseForMedia(datas, view, source_url);
    if (edges.length === 0) return [];

    const collected_at = Date.now();

    return edges
        .filter(e => e["product_type"] !== "ad")
        .map(edge => buildPostRecord(edge, view, collected_at));
}

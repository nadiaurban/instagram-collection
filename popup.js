// popup.js

function formatTime(ts) {
    if (!ts) return '–';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function applyState(state) {
    const { posts, comments, collecting, session_started_at } = state;

    // Status banner
    const banner = document.getElementById('statusBanner');
    if (collecting) {
        banner.textContent = '● Collecting…';
        banner.className = 'active';
    } else if (session_started_at) {
        banner.textContent = '■ Stopped — export or start new session';
        banner.className = 'stopped';
    } else {
        banner.textContent = '● Paused — press Start to collect';
        banner.className = 'idle';
    }

    // Stats
    document.querySelector('#statPosts span').textContent    = posts;
    document.querySelector('#statComments span').textContent = comments;
    document.querySelector('#statSession span').textContent  = formatTime(session_started_at);

    // Button states
    document.getElementById('startBtn').disabled        = collecting;
    document.getElementById('stopBtn').disabled         = !collecting;
    document.getElementById('exportPosts').disabled     = posts === 0;
    document.getElementById('exportComments').disabled  = comments === 0;
}

function refreshStats() {
    browser.runtime.sendMessage({ action: 'getStats' }).then(applyState);
}

// Live updates while popup is open
browser.runtime.onMessage.addListener(message => {
    if (message.type === 'statsUpdate') applyState(message);
});

document.getElementById('startBtn').addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'startCollection' }).then(refreshStats);
});

document.getElementById('stopBtn').addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'stopCollection' }).then(refreshStats);
});

document.getElementById('exportPosts').addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'exportPosts' });
});

document.getElementById('exportComments').addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'exportComments' });
});

document.getElementById('resetBtn').addEventListener('click', () => {
    document.getElementById('confirmReset').style.display = 'block';
});

document.getElementById('confirmYes').addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'reset' }).then(() => {
        document.getElementById('confirmReset').style.display = 'none';
        refreshStats();
    });
});

document.getElementById('confirmNo').addEventListener('click', () => {
    document.getElementById('confirmReset').style.display = 'none';
});

refreshStats();

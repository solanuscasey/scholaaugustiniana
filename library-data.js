/**
 * library-data.js
 * Shared Google Sheets data layer for Academia Augustiniana.
 * Provides loadLibraryTexts(), renderWorkCard(), initAuthorWorks(),
 * and the in-page PDF Reader overlay (openInReader / closeReader).
 */

const LIBRARY_CONFIG = {
    USE_GOOGLE_SHEET: true,
    SHEET_ID: "https://docs.google.com/spreadsheets/d/1jmZMO1afJ_hD4h9FKXwqLI3jnWJQJQPTOLbPN_QjjqE/",
    API_KEY: "AIzaSyC8_tt_9el-5cVDE-2cTLTDDmTdk5mkZRg",
    SHEET_NAME: "LibrarySheet",
    AUTHORS_SHEET_NAME: "AuthorsSheet",  // Second tab: Name | Description | URL | Public
    THESES_SHEET_NAME: "ThesesSheet"     // Third tab: ID | Title | Author | Tradition | Year | Tags | Topic | separator | Total Topic List
};

// Column header names as they appear in the Sheet (row 1).
// Column J is the Image URL column.
const LIBRARY_COLUMNS = {
    id:          "ID",
    title:       "Title",
    author:      "Author",
    tradition:   "Tradition",
    year:        "Year",
    tags:        "Tags",
    pdfUrl:      "PDF URL",
    public:      "Public",
    description: "Description",
    imageUrl:    "Image URL"   // Column J – Drive link/ID for the cover PNG
};

// Column header names for the Authors tab (Sheet2).
const AUTHORS_COLUMNS = {
    name:        "Name",
    description: "Description",
    imageUrl:    "URL",     // Drive link/ID for the portrait image
    public:      "Public"
};

const LIBRARY_DEMO_TEXTS = [
    {
        id: "Error",
        title: "Somethings Gone Wrong",
        author: "- Web Dev",
        tradition: "Patristic",
        year: 400,
        tags: "grace, conversion, autobiography",
        pdfUrl: "",
        public: "TRUE",
        description: "For some reason we cant pull the database, please try again in a few minutes",
        imageUrl: ""
    }
];

// ─── Module-level reader state ──────────────────────────────────────────────
// Populated by initAuthorWorks so the reader sidebar knows all current works.
let _readerWorks  = [];
const _worksById  = {};

// ─── Utilities ──────────────────────────────────────────────────────────────

function normalize(value) {
    return String(value ?? "").trim();
}

function escapeHtml(unsafe) {
    return String(unsafe ?? "")
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;")
        .replace(/"/g,  "&quot;")
        .replace(/'/g,  "&#039;");
}

function isPublic(text) {
    return ["true", "yes", "1"].includes(normalize(text.public).toLowerCase());
}

/** Extract a raw Drive file ID from a full URL or bare ID string. */
function getDriveFileId(urlOrId) {
    const text = normalize(urlOrId);
    const match = text.match(/[-\w]{25,}/);
    return match ? match[0] : "";
}

/** Build a publicly accessible thumbnail URL from a Drive link or ID. */
function getDriveImageUrl(urlOrId) {
    const fileId = getDriveFileId(urlOrId);
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w600` : "";
}

/** Build a "view in Drive" URL. */
function toDriveOpenUrl(urlOrId) {
    const fileId = getDriveFileId(urlOrId);
    return fileId
        ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
        : "";
}

/** Build a Drive embedded preview iframe URL. */
function toDrivePreviewUrl(urlOrId) {
    const fileId = getDriveFileId(urlOrId);
    return fileId
        ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
        : "";
}

// ─── Sheet Parsing ───────────────────────────────────────────────────────────

/** Simple CSV parser for GViz fallback */
function parseCSV(text) {
    const lines = [];
    let line = [];
    let entry = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i+1];
        if (c === '"') {
            if (inQuotes && next === '"') {
                entry += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            line.push(entry);
            entry = '';
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') i++;
            line.push(entry);
            entry = '';
            if (line.length > 1 || line[0] !== '') {
                lines.push(line);
            }
            line = [];
        } else {
            entry += c;
        }
    }
    if (entry !== '' || line.length > 0) {
        line.push(entry);
        lines.push(line);
    }
    return lines;
}

/** Generic sheet values fetcher with Google API & GViz CSV fallback */
async function fetchSheetRows(sheetName) {
    const sheetId = getDriveFileId(LIBRARY_CONFIG.SHEET_ID) || LIBRARY_CONFIG.SHEET_ID;

    if (LIBRARY_CONFIG.USE_GOOGLE_SHEET) {
        try {
            const range = `${sheetName}!A:Z`;
            const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(LIBRARY_CONFIG.API_KEY)}`;
            const response = await fetch(endpoint);
            if (response.ok) {
                const data = await response.json();
                if (data.values) return data.values;
            }
        } catch (e) {
            console.warn(`Google Sheets API fetch failed for ${sheetName}, trying fallback:`, e);
        }
    }

    try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
        const csvResp = await fetch(csvUrl);
        if (csvResp.ok) {
            const csvText = await csvResp.text();
            return parseCSV(csvText);
        }
    } catch (e) {
        console.error(`GViz fallback failed for ${sheetName}:`, e);
    }

    throw new Error(`Could not load data from ${sheetName}`);
}

function parseLibraryRows(values) {
    const [headers, ...rows] = values;
    if (!headers) return [];

    return rows.map(row => {
        const record = {};
        headers.forEach((header, index) => {
            record[normalize(header)] = normalize(row[index]);
        });

        return {
            id:          record[LIBRARY_COLUMNS.id],
            title:       record[LIBRARY_COLUMNS.title],
            // "Author " may have a trailing space in some sheets – normalise both
            author:      record[LIBRARY_COLUMNS.author] || record["Author"],
            tradition:   record[LIBRARY_COLUMNS.tradition],
            year:        record[LIBRARY_COLUMNS.year],
            tags:        record[LIBRARY_COLUMNS.tags],
            pdfUrl:      record[LIBRARY_COLUMNS.pdfUrl],
            public:      record[LIBRARY_COLUMNS.public],
            description: record[LIBRARY_COLUMNS.description],
            imageUrl:    record[LIBRARY_COLUMNS.imageUrl] || ""
        };
    }).filter(t => t.id && t.title && isPublic(t));
}

/** Fetch all public entries from the Google Sheet (falls back to demo data). */
async function loadLibraryTexts() {
    let texts;
    if (!LIBRARY_CONFIG.USE_GOOGLE_SHEET) {
        texts = LIBRARY_DEMO_TEXTS.filter(isPublic);
    } else {
        try {
            const values = await fetchSheetRows(LIBRARY_CONFIG.SHEET_NAME);
            texts = parseLibraryRows(values);
        } catch (err) {
            console.error("Failed to load library texts:", err);
            texts = LIBRARY_DEMO_TEXTS.filter(isPublic);
        }
    }

    // Populate module-level reader state so reader overlay works immediately
    _readerWorks = texts;
    texts.forEach(w => { _worksById[w.id] = w; });

    return texts;
}

// ─── Work Card Renderer ──────────────────────────────────────────────────────

/**
 * Render a single work card in the author-page style.
 * If imageUrl is blank the card is centred with no image column.
 * Includes both "Open PDF ↗" (new tab) and "Read Here" (in-page reader) buttons.
 */
function renderWorkCard(work) {
    const title       = escapeHtml(work.title);
    const description = work.description ? `<p>${escapeHtml(work.description)}</p>` : "";
    const year        = work.year
        ? ` <span style="color:var(--text-secondary);font-size:0.85rem;">(${escapeHtml(work.year)})</span>`
        : "";

    // Both buttons only show when there's a PDF URL
    const pdfButtons = work.pdfUrl ? `
        <a href="${escapeHtml(toDriveOpenUrl(work.pdfUrl))}"
           target="_blank" rel="noopener noreferrer"
           class="btn">Open PDF ↗</a>
        <button class="btn btn-read-here"
                onclick="openInReader('${escapeHtml(work.id)}')">Read Here</button>
    ` : "";

    const imgUrl = work.imageUrl ? getDriveImageUrl(work.imageUrl) : "";

    if (imgUrl) {
        return `
        <div class="work-item glass">
            <div class="work-image-container">
                <img src="${escapeHtml(imgUrl)}" alt="Cover of ${title}" loading="lazy">
            </div>
            <div class="work-details">
                <h3>${title}${year}</h3>
                ${description}
                <div class="work-buttons">${pdfButtons}</div>
            </div>
        </div>`;
    } else {
        return `
        <div class="work-item glass" style="flex-direction:column;align-items:center;text-align:center;">
            <div class="work-details" style="text-align:center;">
                <h3>${title}${year}</h3>
                ${description}
                <div class="work-buttons" style="justify-content:center;">${pdfButtons}</div>
            </div>
        </div>`;
    }
}

// ─── In-Page PDF Reader ──────────────────────────────────────────────────────

/**
 * Build the reader overlay DOM once, then reuse it.
 * Called automatically by openInReader on first use.
 */
function _ensureReaderOverlay() {
    if (document.getElementById("reader-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "reader-overlay";
    overlay.className = "reader-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Document Reader");

    overlay.innerHTML = `
        <div class="reader-sidebar" id="reader-sidebar">
            <div class="reader-sidebar-header">
                <button class="reader-close-btn" onclick="closeReader()" aria-label="Close reader">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
                    </svg>
                    Close
                </button>
                <p class="reader-sidebar-label">Works</p>
            </div>
            <div class="reader-sidebar-list" id="reader-sidebar-list"></div>
        </div>
        <div class="reader-content" id="reader-content">
            <div class="reader-doc-header" id="reader-doc-header">
                <span id="reader-doc-title">Loading…</span>
                <a id="reader-open-tab" class="btn" href="#" target="_blank" rel="noopener noreferrer"
                   style="font-size:0.8rem;padding:0.35rem 0.9rem;">Open in new tab ↗</a>
            </div>
            <iframe id="reader-iframe"
                    title="Document Reader"
                    referrerpolicy="strict-origin-when-cross-origin"
                    allowfullscreen></iframe>
        </div>
    `;

    document.body.appendChild(overlay);

    // Also close on Escape key
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeReader();
    });
}

/**
 * Open the in-page reader and load the given work.
 * Called via onclick from rendered work card buttons.
 */
function openInReader(workId) {
    const work = _worksById[workId];
    if (!work || !work.pdfUrl) return;

    _ensureReaderOverlay();

    // Populate sidebar with all this author's works
    const sidebarList = document.getElementById("reader-sidebar-list");
    sidebarList.innerHTML = _readerWorks.map(w => `
        <button class="reader-sidebar-card${w.id === workId ? " active" : ""}"
                data-id="${escapeHtml(w.id)}"
                onclick="loadInReader('${escapeHtml(w.id)}')">
            <strong>${escapeHtml(w.title)}</strong>
            ${w.year ? `<small>(${escapeHtml(w.year)})</small>` : ""}
        </button>
    `).join("");

    // Show overlay
    const overlay = document.getElementById("reader-overlay");
    overlay.classList.add("open");
    document.body.classList.add("reader-open");

    // Load the selected work into the iframe
    loadInReader(workId);
}

/**
 * Swap the iframe content to a different work without closing the reader.
 */
function loadInReader(workId) {
    const work = _worksById[workId];
    if (!work) return;

    // Update the iframe
    const iframe = document.getElementById("reader-iframe");
    if (iframe) iframe.src = toDrivePreviewUrl(work.pdfUrl);

    // Update header title and "open in tab" link
    const titleEl = document.getElementById("reader-doc-title");
    if (titleEl) titleEl.textContent = work.title;

    const tabLink = document.getElementById("reader-open-tab");
    if (tabLink) tabLink.href = toDriveOpenUrl(work.pdfUrl);

    // Update active state in sidebar
    document.querySelectorAll(".reader-sidebar-card").forEach(card => {
        card.classList.toggle("active", card.dataset.id === workId);
    });
}

/**
 * Close and reset the reader overlay.
 */
function closeReader() {
    const overlay = document.getElementById("reader-overlay");
    if (!overlay) return;

    overlay.classList.remove("open");
    document.body.classList.remove("reader-open");

    // Stop the iframe (deferred so the slide-out animation can complete)
    setTimeout(() => {
        const iframe = document.getElementById("reader-iframe");
        if (iframe) iframe.src = "";
    }, 400);
}

// ─── Author Page Initialiser ─────────────────────────────────────────────────

/**
 * Load and render all works by a given author on their dedicated page.
 *
 * @param {string} authorName  - Must match the "Author" column in the Sheet exactly.
 * @param {string} containerId - ID of the element to render work cards into.
 */
async function initAuthorWorks(authorName, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem 0;">Loading works…</p>`;

    let texts;
    try {
        texts = await loadLibraryTexts();
    } catch (err) {
        console.error(err);
        texts = LIBRARY_DEMO_TEXTS.filter(isPublic);
    }

    const works = texts.filter(t => normalize(t.author) === normalize(authorName));

    if (works.length === 0) {
        container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem 0;">No works are currently listed in the catalog for this author.</p>`;
        return;
    }

    // Store works for the reader sidebar
    _readerWorks = works;
    works.forEach(w => { _worksById[w.id] = w; });

    container.innerHTML = works.map(renderWorkCard).join("");
}

// ─── Authors Sheet Parsing ────────────────────────────────────────────────────

function parseAuthorRows(values) {
    const [headers, ...rows] = values;
    if (!headers) return [];

    return rows.map(row => {
        const record = {};
        headers.forEach((header, index) => {
            record[normalize(header)] = normalize(row[index]);
        });

        return {
            name:        record[AUTHORS_COLUMNS.name],
            description: record[AUTHORS_COLUMNS.description],
            imageUrl:    record[AUTHORS_COLUMNS.imageUrl] || "",
            public:      record[AUTHORS_COLUMNS.public]
        };
    }).filter(a => a.name && isPublic(a));
}

/** Fetch all public authors from Sheet2 of the Google Sheet. */
async function loadAuthors() {
    if (!LIBRARY_CONFIG.USE_GOOGLE_SHEET) return [];
    const values = await fetchSheetRows(LIBRARY_CONFIG.AUTHORS_SHEET_NAME);
    return parseAuthorRows(values);
}

// ─── Author Card Renderer ─────────────────────────────────────────────────────

/**
 * Render a single author card in the same style as the static authors.html grid.
 * The "View Works" button links to author.html?name=<encoded name>.
 */
function renderAuthorCard(author) {
    const name        = escapeHtml(author.name);
    const description = author.description ? escapeHtml(author.description) : "";
    const imgUrl      = author.imageUrl ? getDriveImageUrl(author.imageUrl) : "";
    const worksUrl    = `author.html?name=${encodeURIComponent(author.name)}`;

    return `
    <div class="author-card glass">
        ${imgUrl
            ? `<img src="${escapeHtml(imgUrl)}" alt="${name}" class="author-image" loading="lazy">`
            : `<div class="author-image" style="display:flex;align-items:center;justify-content:center;background:rgba(212,175,55,0.05);font-family:var(--font-heading);font-size:3rem;color:var(--gold);">✦</div>`
        }
        <h2 class="author-name">${name}</h2>
        ${description ? `<p>${description}</p>` : ""}
        <a href="${escapeHtml(worksUrl)}" class="btn">View Works</a>
    </div>`;
}

/**
 * Load and render authors dynamically into a container.
 *
 * @param {string} containerId - ID of the element to render author cards into.
 * @param {string} [statusId]  - Optional ID of a status/message element.
 */
async function initAuthors(containerId, statusId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const statusEl = statusId ? document.getElementById(statusId) : null;
    if (statusEl) statusEl.textContent = "Loading authors…";

    let authors;
    try {
        authors = await loadAuthors();
        if (statusEl) statusEl.textContent = "";
    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = `Could not load authors: ${err.message}`;
        authors = [];
    }

    if (authors.length === 0) {
        container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem 0;grid-column:1/-1;">No authors are currently listed.</p>`;
        return;
    }

    container.innerHTML = authors.map(renderAuthorCard).join("");
}

// ─── Theses Sheet Parsing & Rendering ────────────────────────────────────────

function parseThesesRows(values) {
    const [headers, ...rows] = values;
    if (!headers) return { topicList: [], idTopicMap: [] };

    const topicListSet = new Set();
    const idTopicMap = [];

    let idIdx = headers.findIndex(h => normalize(h).toLowerCase() === "id");
    let topicIdx = headers.findIndex(h => normalize(h).toLowerCase() === "topic");
    let totalTopicsIdx = headers.findIndex(h => normalize(h).toLowerCase() === "total topic list");

    if (idIdx === -1) idIdx = 0;
    if (topicIdx === -1) topicIdx = 6;
    if (totalTopicsIdx === -1) totalTopicsIdx = 8;

    rows.forEach(row => {
        const id = normalize(row[idIdx]);
        const topic = normalize(row[topicIdx]);
        const totalTopic = normalize(row[totalTopicsIdx]);

        if (totalTopic) {
            totalTopic.split(",").forEach(t => {
                const trimmed = normalize(t);
                if (trimmed) topicListSet.add(trimmed);
            });
        }

        if (id && topic) {
            idTopicMap.push({ id, topic });
        }
    });

    return {
        topicList: Array.from(topicListSet),
        idTopicMap
    };
}

async function loadThesesData() {
    if (!LIBRARY_CONFIG.USE_GOOGLE_SHEET) return { topicList: [], idTopicMap: [] };
    const values = await fetchSheetRows(LIBRARY_CONFIG.THESES_SHEET_NAME || "ThesesSheet");
    return parseThesesRows(values);
}

/** Render a single topic card on theses.html */
function renderTopicCard(topicName, worksCount) {
    const topicEsc = escapeHtml(topicName);
    const topicUrl = `thesis-topic.html?topic=${encodeURIComponent(topicName)}`;
    const countLabel = worksCount === 1 ? "1 Work" : `${worksCount} Works`;

    return `
    <div class="topic-card glass">
        <div class="topic-card-icon">📜</div>
        <h2 class="topic-title">${topicEsc}</h2>
        <p class="topic-count">${countLabel}</p>
        <a href="${escapeHtml(topicUrl)}" class="btn">Explore Topic</a>
    </div>`;
}

/** Load and render all topics from Column I on theses.html */
async function initThesesTopics(containerId, statusId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const statusEl = statusId ? document.getElementById(statusId) : null;
    if (statusEl) statusEl.textContent = "Loading Augustinian topics…";

    try {
        const thesesData = await loadThesesData();
        const { topicList, idTopicMap } = thesesData;

        if (statusEl) statusEl.textContent = "";

        if (topicList.length === 0) {
            container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem 0;grid-column:1/-1;">No thesis topics are currently listed.</p>`;
            return;
        }

        // Count works per topic by checking idTopicMap
        const topicCounts = {};
        idTopicMap.forEach(item => {
            const itemTopics = item.topic.split(",").map(t => normalize(t).toLowerCase());
            topicList.forEach(t => {
                const tNorm = normalize(t).toLowerCase();
                if (itemTopics.includes(tNorm) || item.topic.toLowerCase().includes(tNorm)) {
                    topicCounts[t] = (topicCounts[t] || 0) + 1;
                }
            });
        });

        container.innerHTML = topicList.map(topic => renderTopicCard(topic, topicCounts[topic] || 0)).join("");

    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = `Could not load topics: ${err.message}`;
    }
}

/** Load and render works for a selected topic on thesis-topic.html */
async function initTopicWorks(topicName, containerId, titleId, statusId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const titleEl = titleId ? document.getElementById(titleId) : null;
    if (titleEl) titleEl.textContent = `Topic: ${topicName}`;

    const statusEl = statusId ? document.getElementById(statusId) : null;
    if (statusEl) statusEl.textContent = "Loading topic works…";

    try {
        const [thesesData, libraryTexts] = await Promise.all([
            loadThesesData(),
            loadLibraryTexts()
        ]);

        const normTopic = normalize(topicName).toLowerCase();

        // Identify matching IDs from Column A in ThesesSheet whose Column G matches/contains topicName
        const matchingIds = new Set();
        thesesData.idTopicMap.forEach(item => {
            const itemTopics = item.topic.split(",").map(t => normalize(t).toLowerCase());
            if (itemTopics.includes(normTopic) || item.topic.toLowerCase().includes(normTopic)) {
                matchingIds.add(normalize(item.id));
            }
        });

        // Cross-reference with LibrarySheet entries by ID
        const matchingWorks = libraryTexts.filter(work => matchingIds.has(normalize(work.id)));

        if (statusEl) statusEl.textContent = "";

        if (matchingWorks.length === 0) {
            container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem 0;">No works found for this topic.</p>`;
            return;
        }

        // Store works for reader overlay
        _readerWorks = matchingWorks;
        matchingWorks.forEach(w => { _worksById[w.id] = w; });

        container.innerHTML = matchingWorks.map(renderWorkCard).join("");

    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = `Error loading works for topic: ${err.message}`;
    }
}


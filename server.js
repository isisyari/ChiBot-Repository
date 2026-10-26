require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// ============ ENCYCLOPEDIA DATA ============
const ENCYCLOPEDIA_PATH = path.join(__dirname, 'ChiBot-Repository');
let encyclopediaEntries = [];

// Load all encyclopedia entries on startup
function loadEncyclopedia() {
    console.log('📚 Loading encyclopedia entries...');
    const entries = [];

    function readDir(dirPath) {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory() && !item.startsWith('.')) {
                    readDir(fullPath);
                } else if (item.endsWith('.txt')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const parsed = JSON.parse(content);
                        if (parsed.Title) {
                            entries.push({
                                title: parsed.Title || '',
                                text: parsed['Descriptive Text'] || '',
                                bibliography: parsed.Bibliography || '',
                                author: parsed['Author of Text'] || '',
                                terms: parsed['Hyperlinked Terms Associated'] || [],
                                addresses: parsed['Street addresses associated'] || [],
                                file: item
                            });
                        }
                    } catch (e) {
                        // Skip files that aren't valid JSON
                    }
                }
            }
        } catch (e) {
            console.error('Error reading directory:', dirPath, e.message);
        }
    }

    readDir(ENCYCLOPEDIA_PATH);
    encyclopediaEntries = entries;
    console.log(`✅ Loaded ${entries.length} encyclopedia entries`);
}

// Search encyclopedia entries
function searchEncyclopedia(query, maxResults = 5) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Score each entry
    const scored = encyclopediaEntries.map(entry => {
        let score = 0;
        const titleLower = entry.title.toLowerCase();
        const textLower = entry.text.toLowerCase();
        const termsLower = entry.terms.map(t => t.toLowerCase()).join(' ');

        // Exact title match (highest weight)
        if (titleLower === queryLower) score += 100;

        // Title contains query
        if (titleLower.includes(queryLower)) score += 50;

        // Query words in title
        for (const word of queryWords) {
            if (titleLower.includes(word)) score += 20;
            if (termsLower.includes(word)) score += 10;
            if (textLower.includes(word)) score += 2;
        }

        // Boost for related terms matching
        for (const term of entry.terms) {
            if (queryLower.includes(term.toLowerCase())) score += 15;
        }

        return { entry, score };
    });

    // Sort by score and return top results
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(s => s.entry);
}

// Load encyclopedia on startup
loadEncyclopedia();

// Load API keys from environment variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Verify keys are loaded
if (!ANTHROPIC_API_KEY) {
    console.error('ERROR: Missing ANTHROPIC_API_KEY in .env file!');
    process.exit(1);
}

// ============ COLLECTIONS (MAP LAYERS) ============
// Each collection is one map layer, backed by its own public Google Sheet.
// Every sheet must use the same column headers (see maxwell_street_template.csv):
//   Name, Title, Description, Year, Street_Address, Latitude, Longitude, Neighborhood,
//   Photo_File, Photographer, Photo Date, Source URL, Catalog_Record_ID, Permalink
// The server tags every record with `Collection` (the id below) so the front end can
// toggle layers by filtering on that one field.
//
// To add a collection: add an entry here (or set its sheet id in .env), nothing else.
const COLLECTIONS = [
    {
        id: 'building-clearance',
        name: 'Chicago Building Clearance Collection',
        description: 'Photographs of buildings slated for demolition, 1950s-1960s. Gift of Neil Kane.',
        sheetId: process.env.BUILDING_CLEARANCE_SHEET_ID || '1qEFwB4SBhQP8StMvA3dqW4law1MCL822lSv_2LBrJIs'
    },
    {
        id: 'maxwell-street',
        name: 'Maxwell Street Collection',
        description: 'Photographs and media documenting the Maxwell Street Market and Near West Side.',
        sheetId: process.env.MAXWELL_STREET_SHEET_ID || ''
    }
];

const CACHE_TTL_MS = 5 * 60 * 1000; // re-fetch a sheet at most every 5 minutes
const sheetCache = {}; // collectionId -> { fetchedAt, records }

function sheetCsvUrl(sheetId) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
}

// GET a URL and resolve with the body text, following one level of redirects
// (Google Sheets usually redirects the CSV export).
function fetchText(urlString, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        const target = new URL(urlString);
        const options = {
            hostname: target.hostname,
            path: target.pathname + target.search,
            method: 'GET',
            headers: { 'User-Agent': 'ChiBot/1.0' }
        };
        https.request(options, (apiRes) => {
            if ((apiRes.statusCode === 301 || apiRes.statusCode === 302) && apiRes.headers.location) {
                apiRes.resume();
                if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
                return fetchText(apiRes.headers.location, redirectsLeft - 1).then(resolve, reject);
            }
            if (apiRes.statusCode !== 200) {
                apiRes.resume();
                return reject(new Error(`HTTP ${apiRes.statusCode} from ${target.hostname}`));
            }
            let data = '';
            apiRes.on('data', chunk => { data += chunk; });
            apiRes.on('end', () => resolve(data));
        }).on('error', reject).end();
    });
}

// Fetch and normalize one collection's records, using the cache when fresh.
async function loadCollection(collection) {
    if (!collection.sheetId) return []; // registered but no sheet yet

    const cached = sheetCache[collection.id];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.records;

    const csv = await fetchText(sheetCsvUrl(collection.sheetId));
    const records = parseCSV(csv, collection);
    sheetCache[collection.id] = { fetchedAt: Date.now(), records };
    console.log(`📷 ${collection.id}: loaded ${records.length} records`);
    return records;
}

// Load several collections in parallel. A failing sheet logs an error and
// contributes zero records instead of failing the whole response.
async function loadCollections(collections) {
    const results = await Promise.all(collections.map(async (c) => {
        try {
            return await loadCollection(c);
        } catch (e) {
            console.error(`Collection "${c.id}" failed to load:`, e.message);
            return [];
        }
    }));
    return results.flat();
}

// Case/space-insensitive header lookup so sheets can use "Photo Date" or "Photo_Date".
function pick(fields, ...names) {
    for (const name of names) {
        if (fields[name] !== undefined && fields[name] !== '') return fields[name];
    }
    return '';
}

function normalizeHeader(h) {
    return h.replace(/^﻿/, '').trim();
}

// Parse a sheet's CSV into normalized map records tagged with the collection.
function parseCSV(csvText, collection) {
    const lines = csvText.split('\n');
    const headers = parseCSVLine(lines[0]).map(normalizeHeader);
    const records = [];

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        const values = parseCSVLine(lines[i]);
        const fields = {};

        headers.forEach((header, index) => {
            fields[header] = values[index] || '';
        });

        const photoUrl = pick(fields, 'Photo_File', 'Photo File', 'Photo_URL');
        const lat = pick(fields, 'Latitude', 'Lat');
        const lng = pick(fields, 'Longitude', 'Lng', 'Long');

        records.push({
            id: `${collection.id}-${i}`,
            fields: {
                Collection: collection.id,
                Collection_Name: collection.name,
                Name: pick(fields, 'Name', 'Title'),
                Title: pick(fields, 'Title'),
                Description: pick(fields, 'Description'),
                Year: pick(fields, 'Year'),
                Street_Address: pick(fields, 'Street_Address', 'Street Address', 'Address'),
                Latitude: lat ? parseFloat(lat) : null,
                Longitude: lng ? parseFloat(lng) : null,
                Neighborhood: pick(fields, 'Neighborhood'),
                Photo_File: photoUrl ? [{ url: fixPhotoUrl(photoUrl) }] : [],
                Photographer: pick(fields, 'Photographer', 'Creator'),
                Photo_Date: pick(fields, 'Photo Date', 'Photo_Date', 'Date'),
                Source_URL: pick(fields, 'Source URL', 'Source_URL'),
                Catalog_Record_ID: pick(fields, 'Catalog_Record_ID', 'Catalog Record ID'),
                Permalink: pick(fields, 'Permalink', 'Catalog record')
            }
        });
    }

    return records;
}

// The Chicago History Museum moved its image CDN. Links in the spreadsheet use the old path:
//   https://images.chicagohistory.org/cdn/chicagohistorymuseum/previews/{N}/{hash1}/{K}/{hash2}/{assetId}.jpg
// The current path inserts the asset ID after {N} and uses the fe-cdn/chm prefix:
//   https://images.chicagohistory.org/fe-cdn/chm/previews/{N}/{assetId}/{hash1}/{K}/{hash2}/{assetId}.jpg
// Rewrite on the fly so the sheet keeps working without editing every row.
const OLD_CDN_PATTERN = /^https:\/\/images\.chicagohistory\.org\/cdn\/chicagohistorymuseum\/previews\/(\d+)\/([0-9a-f]+)\/(\d+)\/([0-9a-f]+)\/(\d+)\.jpg$/i;
function fixPhotoUrl(url) {
    const m = OLD_CDN_PATTERN.exec(url || '');
    if (!m) return url;
    const [, n, hash1, k, hash2, assetId] = m;
    return `https://images.chicagohistory.org/fe-cdn/chm/previews/${n}/${assetId}/${hash1}/${k}/${hash2}/${assetId}.jpg`;
}

// Parse a single CSV line (handles quoted fields with commas)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());

    return result;
}

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Parse URL
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ============ COLLECTIONS (LAYER LIST) ENDPOINT ============
    // Returns every registered layer with its record count, so the front end can
    // build layer toggles without hardcoding names.
    if (req.method === 'GET' && url.pathname === '/api/collections') {
        Promise.all(COLLECTIONS.map(async (c) => {
            let count = 0;
            try { count = (await loadCollection(c)).length; }
            catch (e) { console.error(`Collection "${c.id}" failed to load:`, e.message); }
            return {
                id: c.id,
                name: c.name,
                description: c.description,
                hasSheet: Boolean(c.sheetId),
                count
            };
        })).then((collections) => {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ collections }));
        });
        return;
    }

    // ============ PHOTOS ENDPOINT ============
    // GET /api/photos                              -> all collections, each record tagged with Collection
    // GET /api/photos?collection=maxwell-street    -> one layer only (comma-separate for several)
    if (req.method === 'GET' && url.pathname === '/api/photos') {
        const requested = (url.searchParams.get('collection') || '')
            .split(',').map(s => s.trim()).filter(Boolean);

        let selected = COLLECTIONS;
        if (requested.length > 0) {
            const unknown = requested.filter(id => !COLLECTIONS.some(c => c.id === id));
            if (unknown.length > 0) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(404);
                res.end(JSON.stringify({
                    error: `Unknown collection: ${unknown.join(', ')}`,
                    available: COLLECTIONS.map(c => c.id)
                }));
                return;
            }
            selected = COLLECTIONS.filter(c => requested.includes(c.id));
        }

        loadCollections(selected).then((records) => {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({
                collections: selected.map(c => c.id),
                count: records.length,
                records
            }));
        }).catch((error) => {
            console.error('Photos endpoint error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        });
        return;
    }

    // ============ ENCYCLOPEDIA SEARCH ENDPOINT ============
    if (req.method === 'POST' && url.pathname === '/api/search') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { query, maxResults } = JSON.parse(body);
                const results = searchEncyclopedia(query, maxResults || 5);

                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({
                    query,
                    count: results.length,
                    totalEntries: encyclopediaEntries.length,
                    results: results.map(r => ({
                        title: r.title,
                        text: r.text.substring(0, 500) + (r.text.length > 500 ? '...' : ''),
                        fullText: r.text,
                        terms: r.terms,
                        addresses: r.addresses,
                        author: r.author
                    }))
                }));
            } catch (error) {
                console.error('Search error:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        });
        return;
    }

    // ============ CLAUDE API ENDPOINT ============
    if (req.method === 'POST' && url.pathname === '/api/chat') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { systemPrompt, messages } = JSON.parse(body);

                const requestData = JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 512,  // Reduced for faster responses
                    system: systemPrompt,
                    messages: messages
                });

                const options = {
                    hostname: 'api.anthropic.com',
                    path: '/v1/messages',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    }
                };

                const apiReq = https.request(options, (apiRes) => {
                    let data = '';

                    apiRes.on('data', chunk => {
                        data += chunk;
                    });

                    apiRes.on('end', () => {
                        res.setHeader('Content-Type', 'application/json');

                        if (apiRes.statusCode === 200) {
                            res.writeHead(200);
                            res.end(data);
                        } else {
                            console.error('Claude API Error:', data);
                            res.writeHead(apiRes.statusCode);
                            res.end(JSON.stringify({ error: 'API request failed', details: data }));
                        }
                    });
                });

                apiReq.on('error', (error) => {
                    console.error('Claude request error:', error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: error.message }));
                });

                apiReq.write(requestData);
                apiReq.end();

            } catch (error) {
                console.error('Parse error:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // ============ 404 NOT FOUND ============
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`\n🚀 ChiBot Proxy Server running at http://localhost:${PORT}`);
    console.log('📍 Endpoints:');
    console.log('   GET  /api/collections            - List map layers (collections)');
    console.log('   GET  /api/photos[?collection=id] - Fetch photos, all layers or one');
    console.log('   POST /api/chat                   - Send messages to Claude AI');
    console.log('   POST /api/search                 - Search encyclopedia entries');
    console.log('\n✅ Using one Google Sheet per collection');
    for (const c of COLLECTIONS) {
        console.log(`   🗂  ${c.id}: ${c.sheetId ? 'sheet ' + c.sheetId : 'NO SHEET YET (set ' + c.id.toUpperCase().replace(/-/g, '_') + '_SHEET_ID in .env)'}`);
    }
    console.log(`📚 Encyclopedia: ${encyclopediaEntries.length} entries loaded\n`);
});

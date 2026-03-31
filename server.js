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

// Google Sheets CSV URL (public)
const GOOGLE_SHEETS_ID = '1qEFwB4SBhQP8StMvA3dqW4law1MCL822lSv_2LBrJIs';
const GOOGLE_SHEETS_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/gviz/tq?tqx=out:csv`;

// Verify keys are loaded
if (!ANTHROPIC_API_KEY) {
    console.error('ERROR: Missing ANTHROPIC_API_KEY in .env file!');
    process.exit(1);
}

// Simple CSV parser
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    const headers = parseCSVLine(lines[0]);
    const records = [];

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        const values = parseCSVLine(lines[i]);
        const fields = {};

        headers.forEach((header, index) => {
            fields[header] = values[index] || '';
        });

        // Transform to match expected format (like Airtable)
        records.push({
            id: `rec${i}`,
            fields: {
                Name: fields.Name || fields.Title || '',
                Title: fields.Title || '',
                Description: fields.Description || '',
                Year: fields.Year || '',
                Street_Address: fields.Street_Address || '',
                Latitude: fields.Latitude ? parseFloat(fields.Latitude) : null,
                Longitude: fields.Longitude ? parseFloat(fields.Longitude) : null,
                Neighborhood: fields.Neighborhood || '',
                Photo_File: fields.Photo_File ? [{ url: fields.Photo_File }] : [],
                Photographer: fields.Photographer || '',
                Photo_Date: fields['Photo Date'] || '',
                Source_URL: fields['Source URL'] || ''
            }
        });
    }

    return { records };
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

    // ============ GOOGLE SHEETS API ENDPOINT ============
    if (req.method === 'GET' && url.pathname === '/api/photos') {
        const sheetsUrl = new URL(GOOGLE_SHEETS_CSV_URL);

        const options = {
            hostname: sheetsUrl.hostname,
            path: sheetsUrl.pathname + sheetsUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'ChiBot/1.0'
            }
        };

        const apiReq = https.request(options, (apiRes) => {
            // Handle redirects (Google often redirects)
            if (apiRes.statusCode === 302 || apiRes.statusCode === 301) {
                const redirectUrl = new URL(apiRes.headers.location);
                const redirectOptions = {
                    hostname: redirectUrl.hostname,
                    path: redirectUrl.pathname + redirectUrl.search,
                    method: 'GET',
                    headers: { 'User-Agent': 'ChiBot/1.0' }
                };

                https.request(redirectOptions, (redirectRes) => {
                    let data = '';
                    redirectRes.on('data', chunk => { data += chunk; });
                    redirectRes.on('end', () => {
                        try {
                            const jsonData = parseCSV(data);
                            res.setHeader('Content-Type', 'application/json');
                            res.writeHead(200);
                            res.end(JSON.stringify(jsonData));
                        } catch (e) {
                            console.error('CSV parse error:', e);
                            res.writeHead(500);
                            res.end(JSON.stringify({ error: 'Failed to parse spreadsheet data' }));
                        }
                    });
                }).on('error', (e) => {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: e.message }));
                }).end();
                return;
            }

            let data = '';
            apiRes.on('data', chunk => { data += chunk; });
            apiRes.on('end', () => {
                try {
                    const jsonData = parseCSV(data);
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify(jsonData));
                } catch (e) {
                    console.error('CSV parse error:', e);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Failed to parse spreadsheet data' }));
                }
            });
        });

        apiReq.on('error', (error) => {
            console.error('Google Sheets request error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        });

        apiReq.end();
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
                    model: 'claude-3-haiku-20240307',
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
    console.log('   GET  /api/photos  - Fetch museum photos from Google Sheets');
    console.log('   POST /api/chat    - Send messages to Claude AI');
    console.log('   POST /api/search  - Search encyclopedia entries');
    console.log('\n✅ Using Google Sheets as database');
    console.log(`📊 Spreadsheet ID: ${GOOGLE_SHEETS_ID}`);
    console.log(`📚 Encyclopedia: ${encyclopediaEntries.length} entries loaded\n`);
});

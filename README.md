# ChiBot

A proxy server for the ChiBot museum app that provides access to Chicago history encyclopedia entries, photo data, and AI-powered chat functionality.

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

1. **Clone or download the project** to your local machine.

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure environment variables:**

   Create a `.env` file in the project root (if it doesn't exist) and add your Anthropic API key:

   ```
   ANTHROPIC_API_KEY=your_api_key_here
   # Optional: one Google Sheet id per map layer (see Collections below)
   BUILDING_CLEARANCE_SHEET_ID=1qEFwB4SBhQP8StMvA3dqW4law1MCL822lSv_2LBrJIs
   MAXWELL_STREET_SHEET_ID=
   ```

4. **Ensure the encyclopedia data exists:**

   The server expects a `ChiBot-Repository` folder containing `.txt` files with encyclopedia entries. This folder should already be included in the project.

## Running Locally

Start the server:

```bash
npm start
```

Or directly with Node:

```bash
node server.js
```

The server will start on `http://localhost:3000`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/collections` | List map layers (collections) with record counts |
| GET | `/api/photos` | Fetch photos from every collection, each tagged with `Collection` |
| GET | `/api/photos?collection=<id>` | Fetch photos from one layer only (comma-separate for several) |
| POST | `/api/chat` | Send messages to Claude AI |
| POST | `/api/search` | Search encyclopedia entries |

## Collections (map layers)

Each collection is one map layer backed by its own public Google Sheet. The server
normalizes every sheet into the same record shape and tags each record with
`fields.Collection` (the layer id) and `fields.Collection_Name`.

Current layers:

| id | Sheet |
|----|-------|
| `building-clearance` | Chicago Building Clearance collection (live) |
| `maxwell-street` | Not connected yet. Set `MAXWELL_STREET_SHEET_ID` in `.env` |

### Front end: showing one layer

Either request a single layer:

```
GET /api/photos?collection=building-clearance
```

or fetch everything once and filter client-side on `record.fields.Collection`.
Use `GET /api/collections` to build the layer toggles instead of hardcoding names.

### Adding a new collection

1. Create a Google Sheet with these exact headers (copy `maxwell_street_template.csv`):
   `Name, Title, Description, Year, Street_Address, Latitude, Longitude, Neighborhood, Photo_File, Photographer, Photo Date, Source URL, Catalog_Record_ID, Permalink`
2. Share it as "Anyone with the link can view" and copy the id from the URL
   (`https://docs.google.com/spreadsheets/d/<ID>/edit`).
3. Add an entry to `COLLECTIONS` in `server.js` with an id, name, description, and the sheet id
   (or read it from `.env` like the existing entries).
4. Restart the server. The layer appears in `/api/collections` automatically.

Rows need `Latitude`, `Longitude`, and `Photo_File` (a direct image URL) to show on the map.
Sheets are cached for 5 minutes, so edits take up to 5 minutes to appear.

### Maxwell Street intake

`maxwell_street_template.csv` is prefilled with the 51 image records from the CHM catalog
export (`maxwell_street_presentation_Angela-highlights.xlsx`). Each row is a catalog record
that links to many photos on images.chicagohistory.org. To get them on the map, each
individual photo needs its own row with an address or coordinates and a direct image URL,
the same way the Building Clearance sheet was built.

### Example: Search Encyclopedia

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "chicago fire", "maxResults": 5}'
```

### Example: Chat with Claude

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "systemPrompt": "You are a helpful assistant about Chicago history.",
    "messages": [{"role": "user", "content": "Tell me about the Great Chicago Fire"}]
  }'
```

## Project Structure

```
chibot project1/
├── server.js           # Main proxy server
├── package.json        # Node.js dependencies
├── .env                # Environment variables (API keys)
└── ChiBot-Repository/  # Encyclopedia entries (JSON in .txt files)
```

## Troubleshooting

- **"Missing ANTHROPIC_API_KEY"**: Make sure your `.env` file exists and contains a valid API key.
- **"0 encyclopedia entries loaded"**: Ensure the `ChiBot-Repository` folder exists and contains `.txt` files with valid JSON content.
- **CORS issues**: The server enables CORS by default, but if you're having issues, make sure you're accessing it from `http://localhost:3000`.

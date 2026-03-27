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
| GET | `/api/photos` | Fetch museum photos from Google Sheets |
| POST | `/api/chat` | Send messages to Claude AI |
| POST | `/api/search` | Search encyclopedia entries |

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

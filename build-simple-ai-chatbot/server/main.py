"""
main.py  –  FastAPI backend for the AI Chatbot
------------------------------------------------
This file is the ENTIRE backend. It:
  1. Loads your secret API key from a .env file
  2. Exposes a single HTTP endpoint: POST /api/chat
  3. Calls the Anthropic Claude API with the full conversation history
  4. Returns Claude's reply to the browser

Run it with:
    uvicorn main:app --reload --port 8000
"""

import os
import uuid                          # for generating session IDs on the server side
from dotenv import load_dotenv       # reads .env file into os.environ
import anthropic                     # official Anthropic Python SDK

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 1. Load environment variables from .env ──────────────────────────────────
# This MUST happen before we create the Anthropic client so that
# ANTHROPIC_API_KEY is already in the environment.
load_dotenv()

# ── 2. Constants you can tweak ───────────────────────────────────────────────
# Change the model here if you want to try a different Claude version.
CLAUDE_MODEL = "claude-3-5-sonnet-20241022"

# The system prompt tells Claude how to behave.
SYSTEM_PROMPT = "You are a helpful, friendly assistant."

# How many tokens Claude is allowed to generate in one reply.
MAX_TOKENS = 1024

# ── 3. In-memory session store ───────────────────────────────────────────────
# Key   = session_id (a string sent by the browser in the X-Session-Id header)
# Value = list of message dicts, e.g.:
#         [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello!"}]
#
# ⚠️  This lives in RAM. It resets every time the server restarts.
#     For a real app you would use a database (Redis, SQLite, etc.)
sessions: dict[str, list[dict]] = {}

# ── 4. Anthropic client ──────────────────────────────────────────────────────
# The SDK automatically reads ANTHROPIC_API_KEY from the environment.
# We still pass it explicitly here so a missing key gives a clear error.
api_key = os.getenv("ANTHROPIC_API_KEY")
if not api_key:
    raise RuntimeError(
        "ANTHROPIC_API_KEY is not set. "
        "Create server/.env and add: ANTHROPIC_API_KEY=sk-ant-..."
    )

claude = anthropic.Anthropic(api_key=api_key)

# ── 5. FastAPI app ───────────────────────────────────────────────────────────
app = FastAPI(title="AI Chatbot Backend")

# CORS – lets the browser (a different origin) call our API.
# During local development the frontend is opened as a file:// URL or
# a local server on a different port, so we allow everything (*).
# In production, replace "*" with your actual frontend URL, e.g.:
#   "https://my-chatbot.netlify.app"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # ← Change this in production!
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 6. Request/Response schemas ──────────────────────────────────────────────
class ChatRequest(BaseModel):
    """What the browser sends us."""
    message: str   # the user's new message text

class ChatResponse(BaseModel):
    """What we send back to the browser."""
    reply: str     # Claude's response text

# ── 7. The chat endpoint ─────────────────────────────────────────────────────
@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    x_session_id: str | None = Header(default=None),  # reads X-Session-Id header
):
    """
    Receives a user message, appends it to the session history,
    calls Claude with the full history, stores Claude's reply,
    and returns it.
    """

    # ── 7a. Validate the incoming message ────────────────────────────────────
    message_text = body.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    # ── 7b. Resolve the session ID ───────────────────────────────────────────
    # If the browser didn't send a session ID we create one.
    # (The browser generates its own ID in localStorage, so this fallback
    #  should rarely be needed.)
    session_id = x_session_id or str(uuid.uuid4())

    # ── 7c. Get (or create) the conversation history for this session ─────────
    if session_id not in sessions:
        sessions[session_id] = []   # first message from this user

    history = sessions[session_id]

    # ── 7d. Append the user's new message to history ─────────────────────────
    history.append({"role": "user", "content": message_text})

    # ── 7e. Call the Anthropic API ────────────────────────────────────────────
    try:
        response = claude.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,   # system prompt is separate from the messages list
            messages=history,       # send the FULL conversation so Claude has context
        )
    except anthropic.AuthenticationError:
        # API key is wrong or expired
        raise HTTPException(status_code=500, detail="Invalid Anthropic API key.")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="Rate limit reached. Try again in a moment.")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

    # ── 7f. Extract the reply text ────────────────────────────────────────────
    # response.content is a list of content blocks.
    # For a normal text reply there is exactly one block with type="text".
    reply_text = response.content[0].text

    # ── 7g. Store Claude's reply in history so future turns have full context ─
    history.append({"role": "assistant", "content": reply_text})

    # ── 7h. Return the reply to the browser ──────────────────────────────────
    return ChatResponse(reply=reply_text)


# ── 8. Health-check endpoint ─────────────────────────────────────────────────
# Useful for deployment platforms (Render pings this to confirm the app is up).
@app.get("/health")
async def health():
    return {"status": "ok"}

/**
 * app.js  –  Frontend logic for the AI Chatbot
 * -----------------------------------------------
 * This file handles:
 *   1. Generating / retrieving a session ID (stored in localStorage)
 *   2. Sending user messages to our FastAPI backend
 *   3. Rendering messages in the chat transcript
 *   4. Showing / hiding the loading indicator
 *   5. Displaying errors to the user
 *
 * NO secret keys live here – the browser only ever talks to OUR backend.
 */

// ── 1. Configuration ──────────────────────────────────────────────────────────
//
// Change API_BASE_URL when you deploy the backend to Render (or similar).
// During local development, FastAPI runs on port 8000.
//
const API_BASE_URL = "http://localhost:8000";   // ← UPDATE this for production

// ── 2. Session ID ─────────────────────────────────────────────────────────────
//
// We store a random UUID in localStorage so the session survives page refreshes.
// The server uses this ID to look up the right conversation history.
//
function getOrCreateSessionId() {
  let id = localStorage.getItem("chatSessionId");
  if (!id) {
    // crypto.randomUUID() is supported in all modern browsers
    id = crypto.randomUUID();
    localStorage.setItem("chatSessionId", id);
  }
  return id;
}

const SESSION_ID = getOrCreateSessionId();

// ── 3. DOM element references ─────────────────────────────────────────────────
const transcript  = document.getElementById("transcript");
const messageInput = document.getElementById("message-input");
const sendBtn      = document.getElementById("send-btn");
const errorBanner  = document.getElementById("error-banner");
const errorText    = document.getElementById("error-text");
const charCount    = document.getElementById("char-count");
const welcomeEl    = document.getElementById("welcome");

// Max characters we allow in a single message (just a UX guard)
const MAX_CHARS = 2000;

// ── 4. Auto-resize the textarea as the user types ────────────────────────────
messageInput.addEventListener("input", () => {
  // Shrink to auto first so it can shrink when text is deleted
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";

  updateCharCount();
});

function updateCharCount() {
  const len = messageInput.value.length;
  charCount.textContent = `${len} / ${MAX_CHARS}`;
  charCount.className = "char-count";
  if (len > MAX_CHARS * 0.85) charCount.classList.add("warn");
  if (len > MAX_CHARS)        charCount.classList.add("over");
}

// ── 5. Send on Enter (Shift+Enter = newline) ──────────────────────────────────
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();   // don't add a newline
    handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);

// ── 6. Clear conversation button ─────────────────────────────────────────────
document.getElementById("clear-btn").addEventListener("click", () => {
  // Remove all message elements from the transcript
  const messages = transcript.querySelectorAll(".message, .loading-row");
  messages.forEach(el => el.remove());

  // Show the welcome screen again
  if (welcomeEl) welcomeEl.style.display = "";

  // Generate a brand-new session ID so the server starts a fresh history
  const newId = crypto.randomUUID();
  localStorage.setItem("chatSessionId", newId);
  // Reload the page to reinitialise SESSION_ID (simplest approach)
  location.reload();
});

// ── 7. Main send handler ──────────────────────────────────────────────────────
async function handleSend() {
  const text = messageInput.value.trim();

  // ── 7a. Validate ──────────────────────────────────────────────────────────
  if (!text) {
    showError("Please type a message before sending.");
    return;
  }
  if (text.length > MAX_CHARS) {
    showError(`Message is too long (max ${MAX_CHARS} characters).`);
    return;
  }

  // ── 7b. Update UI state ───────────────────────────────────────────────────
  hideError();
  hideWelcome();
  appendMessage("user", text);   // show the user's message immediately
  messageInput.value = "";
  messageInput.style.height = "auto";
  updateCharCount();
  setLoading(true);              // disable input, show dots

  // ── 7c. Call the backend ──────────────────────────────────────────────────
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": SESSION_ID,   // tells the server which history to use
      },
      body: JSON.stringify({ message: text }),
    });

    // ── 7d. Handle HTTP errors ────────────────────────────────────────────
    if (!response.ok) {
      // Try to parse a JSON error detail from FastAPI
      let detail = `Server error (${response.status})`;
      try {
        const errData = await response.json();
        detail = errData.detail || detail;
      } catch (_) { /* ignore JSON parse errors */ }
      throw new Error(detail);
    }

    // ── 7e. Parse and display the reply ───────────────────────────────────
    const data = await response.json();    // { "reply": "..." }
    appendMessage("ai", data.reply);

  } catch (err) {
    // Network failure (server not running, CORS, etc.) or our thrown error
    showError(err.message || "Could not reach the server. Is FastAPI running?");
  } finally {
    // Always re-enable the input whether we succeeded or failed
    setLoading(false);
    messageInput.focus();
  }
}

// ── 8. Render a message bubble ────────────────────────────────────────────────
function appendMessage(role, text) {
  /*
   * role = "user" | "ai"
   * Creates DOM like:
   *   <div class="message user">
   *     <div class="avatar">🧑</div>
   *     <div class="bubble">Hello!</div>
   *   </div>
   */
  const wrapper = document.createElement("div");
  wrapper.classList.add("message", role);

  const avatar = document.createElement("div");
  avatar.classList.add("avatar");
  avatar.textContent = role === "user" ? "🧑" : "🤖";

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.textContent = text;   // textContent is safe – no XSS risk

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  transcript.appendChild(wrapper);

  // Scroll to the newest message
  scrollToBottom();
}

// ── 9. Loading indicator ──────────────────────────────────────────────────────
let loadingRow = null;   // keep a reference so we can remove it later

function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  messageInput.disabled = isLoading;

  if (isLoading) {
    // Build the animated dots element
    loadingRow = document.createElement("div");
    loadingRow.classList.add("loading-row");
    loadingRow.innerHTML = `
      <div class="avatar">🤖</div>
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>`;
    transcript.appendChild(loadingRow);
    scrollToBottom();
  } else {
    // Remove the dots when we have a real answer
    if (loadingRow) {
      loadingRow.remove();
      loadingRow = null;
    }
  }
}

// ── 10. Error banner helpers ──────────────────────────────────────────────────
function showError(message) {
  errorText.textContent = message;
  errorBanner.classList.remove("hidden");
}

function hideError() {
  errorBanner.classList.add("hidden");
  errorText.textContent = "";
}

// ── 11. Welcome screen helper ─────────────────────────────────────────────────
function hideWelcome() {
  if (welcomeEl) welcomeEl.style.display = "none";
}

// ── 12. Scroll helper ─────────────────────────────────────────────────────────
function scrollToBottom() {
  transcript.scrollTop = transcript.scrollHeight;
}

// ── 13. Dismiss error when the user starts typing again ───────────────────────
messageInput.addEventListener("input", hideError);

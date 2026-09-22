#!/usr/bin/env python3
"""Import a Claude data export into a fresh Open WebUI instance.

Runs INSIDE the open-webui container, using OWUI's own Chats.import_chats()
machinery so the legacy `chat` JSON blob and the normalized `chat_message`
rows are written exactly as the API import endpoint would write them.

Usage:
    docker cp importer into container, then:
    docker exec -e WEBUI_SECRET_KEY=<same as server> open-webui python3 /tmp/import_claude.py

Note: WEBUI_SECRET_KEY can be any non-empty string here; it's only needed
because importing open_webui.models.chats requires the config to be readable.
The import itself doesn't touch session/signing paths.
"""
import asyncio
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")

EXPORT_DIR = "/tmp/export"
MODEL_ID = "claude-import"

# ---------------------------------------------------------------------------
# Payload construction from the Claude export


def iso_to_epoch(s):
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def build_message_text(msg):
    """Return the visible text for a Claude message."""
    text = (msg.get("text") or "").strip()
    if text:
        return text

    # File-only user messages: inline the attachment's extracted content
    inlined = []
    for a in msg.get("attachments") or []:
        content = a.get("extracted_content")
        if content:
            name = a.get("file_name") or "attachment"
            inlined.append(f"[Attached file: {name}]\n\n{content}")
    if inlined:
        return "\n\n".join(inlined)

    # Named files with no extracted content
    named = [f.get("file_name") for f in msg.get("files") or [] if f.get("file_name")]
    if named:
        return "*[" + ", ".join(named) + "]*"

    return "*(empty)*"


def convo_to_import_form(c):
    """Turn one Claude conversation dict into a ChatImportForm-shaped dict."""
    msgs = sorted(c.get("chat_messages") or [], key=lambda m: m.get("created_at") or "")
    if not msgs:
        return None

    created = iso_to_epoch(c.get("created_at")) or int(time.time())
    updated = iso_to_epoch(c.get("updated_at")) or created

    ids = [m["uuid"] for m in msgs]
    id_set = set(ids)

    parent_of = {}
    for m in msgs:
        p = m.get("parent_message_uuid")
        parent_of[m["uuid"]] = p if p in id_set else None

    children = {mid: [] for mid in ids}
    for mid, p in parent_of.items():
        if p:
            children[p].append(mid)

    # Current = last message by timestamp (usually an assistant message)
    current_id = msgs[-1]["uuid"]

    # history.messages is the full map (siblings included) in the OWUI legacy format
    history_messages = {}
    for m in msgs:
        mid = m["uuid"]
        role = "user" if m["sender"] == "human" else "assistant"
        history_messages[mid] = {
            "id": mid,
            "parentId": parent_of.get(mid),
            "childrenIds": children.get(mid, []),
            "role": role,
            "content": build_message_text(m),
            "timestamp": iso_to_epoch(m.get("created_at")) or created,
            "models": [MODEL_ID],
        }

    # 'messages' (flat list) — the visible path. Walk back from current_id to its root,
    # then forward along the chain; at branches we always pick the branch leading to current.
    chain = []
    cur = current_id
    seen = set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        chain.append(cur)
        cur = parent_of.get(cur)
    chain.reverse()
    flat_messages = [history_messages[mid] for mid in chain]

    title = (c.get("name") or "").strip()
    if not title:
        first_user = next((m for m in msgs if m["sender"] == "human"), None)
        if first_user:
            t = (first_user.get("text") or "").strip().splitlines()
            if t:
                title = (t[0][:78] + "…") if len(t[0]) > 78 else t[0]
        if not title:
            title = "Imported chat"

    chat = {
        "id": c["uuid"],
        "title": title,
        "models": [MODEL_ID],
        "params": {},
        "history": {"messages": history_messages, "currentId": current_id},
        "messages": flat_messages,
        "tags": [],
        "timestamp": created,
        "files": [],
        "currentId": current_id,
    }

    return {
        "chat": chat,
        "meta": {"imported_from": "claude"},
        "pinned": False,
        "current_message_id": current_id,
        "created_at": created,
        "updated_at": updated,
    }


# ---------------------------------------------------------------------------


async def run():
    from open_webui.models.chats import Chats, ChatImportForm
    from open_webui.models.memories import Memories

    # Find the single user via sqlite (avoids needing async users machinery)
    import sqlite3

    db = sqlite3.connect("/app/backend/data/webui.db")
    rows = db.execute("SELECT id, email FROM user").fetchall()
    db.close()
    assert len(rows) == 1, f"Expected exactly 1 user, got {len(rows)}"
    user_id = rows[0][0]
    print(f"Target user: {rows[0][1]} ({user_id})")

    # Fresh-DB guard
    with open(f"{EXPORT_DIR}/conversations.json") as f:
        convos = json.load(f)
    forms, skip_empty, fb = [], 0, 0
    for c in convos:
        form = convo_to_import_form(c)
        if form is None:
            skip_empty += 1
            continue
        if form["chat"]["title"] in ("Imported chat",):
            fb += 1
        forms.append(ChatImportForm(**form))

    print(f"Prepared {len(forms)} chats (skipped {skip_empty} empty, {fb} fallback titles)")

    imported = await Chats.import_chats(user_id, forms)
    print(f"Imported chats: {len(imported)}")

    # Memories
    mem_dir = f"{EXPORT_DIR}/memories"
    mem_file = os.path.join(mem_dir, os.listdir(mem_dir)[0])
    with open(mem_file) as f:
        mem = json.load(f)

    n_mem = 0
    conv_mem = (mem.get("conversations_memory") or "").strip()
    if conv_mem:
        await Memories.insert_new_memory(user_id=user_id, content=conv_mem, path="/conversations_memory")
        n_mem += 1
    for mf in mem.get("memory_files") or []:
        content = (mf.get("content") or "").strip()
        if content:
            await Memories.insert_new_memory(user_id=user_id, content=content, path=mf.get("path"))
            n_mem += 1
    print(f"Imported memories: {n_mem}")


if __name__ == "__main__":
    import time

    asyncio.run(run())

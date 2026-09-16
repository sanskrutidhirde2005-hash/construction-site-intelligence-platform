/* useConversations — multi-chat history for the GenAI assistants.
   Stored in localStorage (per key), so chats survive reloads on the device.
   Each conversation: { id, title, projectId, messages, createdAt, updatedAt }. */

import { useEffect, useState } from "react";

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const makeConvo = (greetingMessage, projectId) => ({
  id: uid(),
  title: "New conversation",
  projectId: projectId ?? null,
  messages: [greetingMessage],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.filter((c) => c && c.id && Array.isArray(c.messages));
  } catch {
    return null;
  }
}

const titleFor = (messages) => {
  const firstUser = messages.find((m) => m.type === "user" || m.sender === "user");
  if (!firstUser) return "New conversation";
  const t = String(firstUser.text || "").trim().replace(/\s+/g, " ");
  if (t.length <= 42) return t || "New conversation";
  return `${t.slice(0, 42).replace(/\s+\S*$/, "")}…`;
};

export function useConversations({ key, greetingMessage, projectId = null }) {
  const [conversations, setConversations] = useState(() => {
    const saved = load(key);
    if (saved && saved.length) return saved;
    return [makeConvo(greetingMessage, projectId)];
  });
  const [activeId, setActiveId] = useState(() => {
    const saved = load(key);
    return saved && saved.length ? saved[0].id : null;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(conversations.slice(0, 30)));
    } catch {
      /* storage full/blocked — chats still work for the session */
    }
  }, [conversations, key]);

  const active =
    conversations.find((c) => c.id === activeId) || conversations[0];

  const append = (msgs) => {
    const list = Array.isArray(msgs) ? msgs : [msgs];
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== (active && active.id)) return c;
        const messages = [...c.messages, ...list];
        return { ...c, messages, title: titleFor(messages), updatedAt: Date.now() };
      })
    );
  };

  const startNew = (pid = projectId) => {
    const convo = makeConvo(greetingMessage, pid ?? null);
    setConversations((prev) => [convo, ...prev].slice(0, 30));
    setActiveId(convo.id);
  };

  const remove = (id) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const fallback = next.length ? next : [makeConvo(greetingMessage, projectId)];
      if (!next.find((c) => c.id === activeId)) setActiveId(fallback[0].id);
      return fallback;
    });
  };

  const ordered = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return { conversations: ordered, active, activeId, select: setActiveId, startNew, append, remove };
}

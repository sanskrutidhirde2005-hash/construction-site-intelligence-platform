import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import Markdown from "./Markdown";
import { fetchSiteData, answerLocally } from "./assistantEngine";
import { useConversations } from "./useConversations";

const GREETING = {
  type: "ai",
  text: "Hello! I'm BuildSafe AI Assistant. I answer from your actual stored project data — inspections, materials, video observations and site records. Pick a project below and ask away."
};

function GenAI() {
  const [question, setQuestion] = useState("");

  const { conversations, active, activeId, select, startNew, append, remove } =
    useConversations({ key: "buildsafe-genai-chats", greetingMessage: GREETING });
  const messages = active ? active.messages : [GREETING];

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [sending, setSending] = useState(false);
  const [llmMode, setLlmMode] = useState(null); // true = OpenRouter LLM, false = offline grounded

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        setProjects(list || []);
        if (list && list.length > 0) setProjectId(String(list[0].id));
      })
      .catch(() => {});
  }, []);

  // Live site-data cache for the on-device fallback (no fake demo numbers).
  const [siteCache, setSiteCache] = useState(null);

  useEffect(() => {
    let live = true;
    fetchSiteData(projectId ? parseInt(projectId, 10) : null).then((d) => {
      if (live) setSiteCache(d);
    });
    return () => { live = false; };
  }, [projectId]);

  const sendMessage = async (text = question) => {
    if (!text.trim() || sending) return;

    const userMessage = {
      type: "user",
      text: text
    };

    append([userMessage]);

    setQuestion("");
    setSending(true);

    try {
      const res = await fetch("/api/genai/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query_text: text,
          project_id: projectId ? parseInt(projectId, 10) : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Assistant error");
      }

      setLlmMode(data.llm);

      append([{ type: "ai", text: data.answer, sources: data.tools_used || [] }]);
    } catch (err) {
      // Backend unreachable → answer from live cached collections (same math,
      // zero invented numbers). Refresh cache if it's stale/empty.
      let site = siteCache;
      if (!site || !site.reachable) {
        site = await fetchSiteData(projectId ? parseInt(projectId, 10) : null);
        setSiteCache(site);
      }
      const pid = projectId ? parseInt(projectId, 10) : null;
      append([
        {
          type: "ai",
          text: answerLocally(text, site, pid) + "\n\n(On-device answer from live site records — start the backend for full LLM reasoning.)"
        }
      ]);
    }

    setSending(false);
  };

  const quickAction = (text) => {
    sendMessage(text);
  };

  // Keep the latest reply visible (demo-friendly on phones).
  const messagesRef = useRef(null);
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="genai-page">

      {/* Header */}
      <div className="genai-header">
        <div>
          <h1 className="genai-title"><Icon name="bot" /> GenAI Assistant</h1>

          <p>
            Your intelligent construction project assistant
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: "1px",
              border: "1px solid #c7bca1",
            }}
            title="Project context for answers"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="genai-status">
            <span className="genai-status-dot"></span>
            {llmMode === true
              ? "OpenRouter LLM · grounded"
              : llmMode === false
                ? "Grounded · offline mode"
                : "AI Assistant Online"}
          </div>

        </div>
      </div>


      {/* Quick Actions */}
      <section className="genai-quick-actions">

        <h2 className="genai-subtitle"><Icon name="zap" /> Quick Actions</h2>

        <div className="genai-action-buttons">

          <button
            onClick={() =>
              quickAction(
                "Give me today's construction report"
              )
            }
          >
            <Icon name="clipboard" /> Today's Report
          </button>

          <button
            onClick={() =>
              quickAction(
                "Give me the project progress summary"
              )
            }
          >
            <Icon name="chart" /> Project Summary
          </button>

          <button
            onClick={() =>
              quickAction(
                "What are the current risks?"
              )
            }
          >
            <Icon name="alert" /> Risk Summary
          </button>

          <button
            onClick={() =>
              quickAction(
                "What are today's safety issues?"
              )
            }
          >
            <Icon name="shield" /> Safety Summary
          </button>

          <button
            onClick={() =>
              quickAction(
                "What is the material status?"
              )
            }
          >
            <Icon name="package" /> Material Status
          </button>

          <button
            onClick={() =>
              quickAction(
                "What inspections are due?"
              )
            }
          >
            <Icon name="search" /> Inspection Status
          </button>

          <button
            onClick={() =>
              quickAction(
                "What maintenance tasks are overdue?"
              )
            }
          >
            <Icon name="wrench" /> Maintenance Status
          </button>

          <button
            onClick={() =>
              quickAction(
                "Will this project exceed its budget?"
              )
            }
          >
            <Icon name="wallet" /> Budget Forecast
          </button>

        </div>

      </section>


      {/* Chat */}
      <section className="genai-chat-section">

        <div className="genai-chat-header">

          <div>
            <h2 className="genai-subtitle"><Icon name="chat" /> Ask BuildSafe AI</h2>

            <p>
              Ask questions about your construction data.
            </p>
          </div>

        </div>


        {/* Conversation history: new chat + switch between past chats */}
        <div className="genai-convo-bar">
          <button
            type="button"
            className="genai-new-chat-btn"
            onClick={() => startNew(projectId ? parseInt(projectId, 10) : null)}
          >
            <Icon name="plus" /> New chat
          </button>

          <select
            value={activeId || ""}
            onChange={(e) => select(e.target.value)}
            aria-label="Previous conversations"
            title="Switch conversation"
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          {conversations.length > 1 && (
            <button
              type="button"
              className="genai-del-chat-btn"
              onClick={() => remove(activeId)}
              aria-label="Delete this conversation"
              title="Delete this conversation"
            >
              <Icon name="trash" />
            </button>
          )}
        </div>


        {/* Messages */}
        <div className="genai-messages" ref={messagesRef}>

          {messages.map((message, index) => (

            <div
              key={index}
              className={`genai-message ${
                message.type === "user"
                  ? "genai-user-message"
                  : "genai-ai-message"
              }`}
            >

              <div className="genai-avatar" aria-hidden="true">
                {message.type === "user"
                  ? <Icon name="user" />
                  : <Icon name="bot" />}
              </div>


              <div className="genai-message-content">

                <strong>
                  {message.type === "user"
                    ? "You"
                    : "BuildSafe AI"}
                </strong>

                {message.type === "user" ? (
                  <p>{message.text}</p>
                ) : (
                  <Markdown text={message.text} />
                )}

                {message.type !== "user" && message.sources?.length > 0 && (
                  <small className="genai-sources">
                    Answered from:{" "}
                    {message.sources
                      .map((s) => s.replace(/^get_/, "").replace(/_/g, " "))
                      .join(" · ")}
                  </small>
                )}

              </div>

            </div>

          ))}

        </div>


        {/* Input */}
        <div className="genai-input-area">

          <input
            type="text"
            value={question}
            placeholder="Ask about projects, risks, safety, materials..."
            onChange={(e) =>
              setQuestion(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendMessage();
              }
            }}
          />


          {/* Voice Button */}
          <button
            className="genai-mic-btn"
            title="Voice input will be connected next"
            aria-label="Voice input (coming soon)"
          >
            <Icon name="mic" />
          </button>


          {/* Send Button */}
          <button
            className="genai-send-btn"
            onClick={() => sendMessage()}
            aria-label="Send message"
          >
            <Icon name="send" />
          </button>

        </div>


        <div className="genai-suggestion">
          <Icon name="bulb" /> Try: "What are today's safety issues?"
        </div>

      </section>


      {/* Prototype Note */}
      <div className="genai-demo-note">

        <strong>Data-grounded answers:</strong>{" "}
        The assistant now reads your real stored projects,
        inspections, materials and video observations. Add
        OPENROUTER_API_KEY to backend/.env for full LLM
        answers, otherwise it replies from live database
        records.

      </div>

    </div>
  );
}

export default GenAI;
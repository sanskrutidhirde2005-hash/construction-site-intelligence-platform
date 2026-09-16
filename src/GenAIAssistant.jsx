import { useEffect, useRef, useState } from "react";
import "./GenAIAssistant.css";
import { Icon } from "./icons";
import Markdown from "./Markdown";
import { fetchSiteData, answerLocally } from "./assistantEngine";
import { useConversations } from "./useConversations";

function GenAIAssistant({ project, onBack }) {
  const { conversations, active, activeId, select, startNew, append, remove } =
    useConversations({
      key: `buildsafe-genai-chats:project:${project.id}`,
      greetingMessage: {
        sender: "ai",
        text: `Hello! I am your AI Construction Assistant for ${project.name}. Ask me about project progress, materials, safety, inspections, delays or risks.`,
      },
      projectId: project.id,
    });
  const messages = active
    ? active.messages
    : [
        {
          sender: "ai",
          text: `Hello! I am your AI Construction Assistant for ${project.name}. Ask me about project progress, materials, safety, inspections, delays or risks.`,
        },
      ];

  const [input, setInput] = useState("");

  const suggestedQuestions = [
    "What is the current project progress?",
    "Are there any safety issues?",
    "Which materials are low in stock?",
    "What inspections are pending?",
    "What are the major project risks?",
  ];

  // Live site-data cache so answers come from real records, not templates.
  const [siteCache, setSiteCache] = useState(null);

  useEffect(() => {
    let live = true;
    fetchSiteData(project.id).then((d) => {
      if (live) setSiteCache(d);
    });
    return () => { live = false; };
  }, [project.id]);

  const sendMessage = async (question = input) => {
    const text = question.trim();

    if (!text) return;

    const userMessage = {
      sender: "user",
      text: text,
    };

    append([userMessage]);
    setInput("");

    // 1) Backend brain (LLM if key set, else grounded offline mode).
    try {
      const res = await fetch("/api/genai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query_text: text, project_id: project.id }),
      });
      if (res.ok) {
        const data = await res.json();
        append([{ sender: "ai", text: data.answer, sources: data.tools_used || [] }]);
        return;
      }
    } catch {
      /* fall through to on-device engine */
    }

    // 2) On-device engine over live collections for THIS project.
    let site = siteCache;
    if (!site || !site.reachable) {
      site = await fetchSiteData(project.id);
      setSiteCache(site);
    }
    append([
      {
        sender: "ai",
        text:
          answerLocally(text, site, project.id) +
          "\n\n(On-device answer from live site records — start the backend for full LLM reasoning.)",
      },
    ]);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  // Keep the latest reply visible (demo-friendly on phones).
  const messagesRef = useRef(null);
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="genai-page">

      {/* HEADER */}
      <div className="genai-header">
        <div>
          <button className="genai-back-btn" onClick={onBack}>
            <Icon name="arrowLeft" /> Back to Project
          </button>

          <h1 className="genai-title"><Icon name="bot" /> GenAI Construction Assistant</h1>

          <p>
            Intelligent assistant for{" "}
            <strong>{project.name}</strong>
          </p>
        </div>

        <div className="ai-status">
          <span className="status-dot"></span>
          AI Assistant Online
        </div>
      </div>

      {/* PROJECT CONTEXT */}
      <div className="ai-context-card">
        <div>
          <span>Project</span>
          <strong>{project.name}</strong>
        </div>

        <div>
          <span>Location</span>
          <strong>{project.location}</strong>
        </div>

        <div>
          <span>Progress</span>
          <strong>{project.progress}%</strong>
        </div>

        <div>
          <span>Status</span>
          <strong>{project.status}</strong>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="genai-layout">

        {/* SIDEBAR */}
        <div className="ai-suggestions">

          <h3 className="genai-subtitle"><Icon name="bulb" /> Suggested Questions</h3>

          <p>
            Ask me anything about this construction project.
          </p>

          {suggestedQuestions.map((question, index) => (
            <button
              key={index}
              onClick={() => sendMessage(question)}
            >
              {question}
            </button>
          ))}

          <div className="ai-capabilities">
            <h4>AI Capabilities</h4>

            <div><Icon name="chart" /> Progress Analysis</div>
            <div><Icon name="package" /> Material Monitoring</div>
            <div><Icon name="shield" /> Safety Analysis</div>
            <div><Icon name="search" /> Inspection Analysis</div>
            <div><Icon name="alert" /> Risk Detection</div>
            <div><Icon name="file" /> Document Search</div>
          </div>
        </div>

        {/* CHAT */}
        <div className="chat-container">

          <div className="chat-header">
            <div className="bot-icon" aria-hidden="true"><Icon name="bot" /></div>

            <div>
              <h3>Construction AI</h3>
              <span>
                Project intelligence assistant
              </span>
            </div>
          </div>

          {/* MESSAGES */}
          <div className="chat-messages" ref={messagesRef}>

            {/* Conversation history: new chat + switch between past chats */}
            <div className="genai-convo-bar">
              <button
                type="button"
                className="genai-new-chat-btn"
                onClick={() => startNew(project.id)}
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

            {messages.map((message, index) => (
              <div
                key={index}
                className={`message-row ${message.sender}`}
              >

                {message.sender === "ai" && (
                  <div className="message-avatar" aria-hidden="true">
                    <Icon name="bot" />
                  </div>
                )}

                <div className="message-bubble">
                  {message.sender === "ai" ? (
                    <Markdown text={message.text} />
                  ) : (
                    message.text
                  )}
                  {message.sender === "ai" && message.sources?.length > 0 && (
                    <small className="genai-sources">
                      Answered from:{" "}
                      {message.sources
                        .map((s) => s.replace(/^get_/, "").replace(/_/g, " "))
                        .join(" · ")}
                    </small>
                  )}
                </div>

                {message.sender === "user" && (
                  <div className="message-avatar user-avatar" aria-hidden="true">
                    <Icon name="user" />
                  </div>
                )}

              </div>
            ))}

          </div>

          {/* INPUT */}
          <div className="chat-input-area">

            <input
              type="text"
              placeholder="Ask about project progress, materials, safety..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            <button onClick={() => sendMessage()} aria-label="Send message">
              <Icon name="send" />
            </button>

          </div>

          <div className="ai-disclaimer">
            <Icon name="bot" /> Answers come from live project records via read-only data tools —
            never invented.
          </div>

        </div>
      </div>
    </div>
  );
}

export default GenAIAssistant;
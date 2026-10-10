import { agentPlatformLabel, sessionResumeCommand } from "../agentSessions";
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import type { TaskConversationItem } from "../taskConversations";
import { useTaskboardI18n } from "../i18n";
import { listenForMenuViewportChange, listenForOutsidePointerDown } from "../menuEvents";
import { ConversationIcon } from "./SemanticIcons";
import { openClaudeApp, openIssueInIterm } from "../api";

interface TaskConversationMenuProps {
  conversations: TaskConversationItem[];
  onOpenConversation: (conversation: TaskConversationItem) => void;
}

function conversationSource(
  conversation: TaskConversationItem,
  text: (chinese: string, english: string) => string,
) {
  if (conversation.kind === "local-ai") return text("内置 AI", "Built-in AI");
  if (conversation.kind === "agent-session") {
    return conversation.source === "comment"
      ? text("评论对话 · 复制恢复命令", "Comment conversation · Copy resume command")
      : text("任务对话 · 复制恢复命令", "Task conversation · Copy resume command");
  }
  return conversation.source === "comment"
    ? text("评论对话", "Comment conversation")
    : text("任务对话", "Task conversation");
}

function conversationStatus(
  conversation: TaskConversationItem,
  text: (chinese: string, english: string) => string,
) {
  if (conversation.currentRun?.status === "running") {
    if (conversation.latestTodo?.total) {
      return `${conversation.latestTodo.completed}/${conversation.latestTodo.total}`;
    }
    return text("正在处理", "Processing");
  }
  if (conversation.agentSession) return agentPlatformLabel(conversation.agentSession.platform);
  return conversation.kind === "local-ai" ? text("已暂停", "Paused") : "Codex";
}

export function TaskConversationMenu({
  conversations,
  onOpenConversation,
}: TaskConversationMenuProps) {
  const { text } = useTaskboardI18n();
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 6;
    const left = Math.max(8, Math.min(
      window.innerWidth - menuRect.width - 8,
      rect.right - menuRect.width,
    ));
    const preferredTop = rect.bottom + gap;
    const top = preferredTop + menuRect.height <= window.innerHeight - 8
      ? preferredTop
      : Math.max(8, rect.top - menuRect.height - gap);
    setPosition({ left, top, ready: true });
  }, [open, conversations.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const stopOutside = listenForOutsidePointerDown([triggerRef, menuRef], close);
    const stopViewport = listenForMenuViewportChange(menuRef, close);
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    window.addEventListener("keydown", closeFromEscape);
    return () => {
      stopOutside();
      stopViewport();
      window.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  if (conversations.length === 0) return null;

  function stop(event: SyntheticEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function openConversation(conversation: TaskConversationItem) {
    setOpen(false);
    onOpenConversation(conversation);
  }

  const multiple = conversations.length > 1;
  const singleConversation = !multiple ? conversations[0] : undefined;
  const singleAgentSession = singleConversation?.agentSession;
  const singlePlatform = singleAgentSession?.platform
    ?? (singleConversation?.kind === "native" ? "codex" : null);
  const singlePlatformLabel = singleAgentSession
    ? agentPlatformLabel(singleAgentSession.platform)
    : singlePlatform === "codex" ? "Codex" : "";
  const platformClass = singlePlatform === "codex" || singlePlatform === "claude"
    ? ` is-platform-${singlePlatform}`
    : "";
  const hasPlatformActions = singlePlatform === "codex" || singlePlatform === "claude";

  async function openPlatformApp() {
    if (!singleConversation || (singlePlatform !== "codex" && singlePlatform !== "claude")) return;
    setActionError(null);
    if (singlePlatform === "codex") {
      openConversation(singleConversation);
      return;
    }
    setActionBusy(true);
    try {
      await openClaudeApp();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function openPlatformCli() {
    if (!singleConversation || (singlePlatform !== "codex" && singlePlatform !== "claude")) return;
    setActionError(null);
    setActionBusy(true);
    try {
      const sessionId = singleConversation.agentSession?.sessionId
        ?? singleConversation.threadBinding?.threadId
        ?? singleConversation.legacyLocalThreadId
        ?? (singleConversation.kind === "native" ? singleConversation.nativeThreadId : null);
      await openIssueInIterm(singleConversation.taskId, undefined, singlePlatform, sessionId ?? undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  }

  function platformIcon(platform: "codex" | "claude") {
    return platform === "codex" ? (
      <img className="task-conversation-platform-icon" src="/codex-agent-logo.png" alt="" aria-hidden="true" />
    ) : (
      <svg className="task-conversation-platform-icon is-claude" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M5.29 5.29l3.54 3.54m6.34 6.34 3.54 3.54m0-13.42-3.54 3.54m-6.34 6.34-3.54 3.54" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      </svg>
    );
  }

  if (hasPlatformActions && singleConversation && singlePlatform) {
    const platformName = singlePlatform === "codex" ? "Codex" : "Claude";
    const cliName = "CLI";
    return (
      <span className="task-conversation-actions" onPointerDown={stop} onClick={stop}>
        <button
          className={`task-conversation-trigger is-platform-${singlePlatform} is-cli-entry`}
          type="button"
          disabled={actionBusy}
          aria-label={text(`在 ${platformName} ${cliName} 打开`, `Open in ${platformName} ${cliName}`)}
          title={text(`在 ${platformName} ${cliName} 打开`, `Open in ${platformName} ${cliName}`)}
          onClick={() => void openPlatformCli()}
        >
          <span className="task-conversation-cli-icon" aria-hidden="true">›_</span>
          <span>{cliName}</span>
        </button>
        <button
          className={`task-conversation-trigger is-platform-${singlePlatform}`}
          type="button"
          disabled={actionBusy}
          aria-label={text(`在 ${platformName} App 打开`, `Open in ${platformName} App`)}
          title={text(`在 ${platformName} App 打开`, `Open in ${platformName} App`)}
          onClick={() => void openPlatformApp()}
        >
          {platformIcon(singlePlatform)}
          <span>{platformName}</span>
        </button>
        {actionError && <span className="task-conversation-action-error" role="alert" title={actionError}>!</span>}
      </span>
    );
  }
  return (
    <>
      <button
        ref={triggerRef}
        className={`task-conversation-trigger${multiple ? " is-multiple" : ""}${singlePlatformLabel ? " has-platform-label" : ""}${platformClass}${open ? " is-open" : ""}`}
        type="button"
        draggable={false}
        aria-label={multiple
          ? text(`查看 ${conversations.length} 个对话`, `View ${conversations.length} conversations`)
          : singleAgentSession
            ? text(`复制 ${singlePlatformLabel} 恢复命令`, `Copy ${singlePlatformLabel} resume command`)
            : singlePlatformLabel
              ? text(`打开 ${singlePlatformLabel} 对话`, `Open ${singlePlatformLabel} conversation`)
              : text(`打开对话 ${conversations[0].title}`, `Open conversation ${conversations[0].title}`)}
        aria-haspopup={multiple ? "menu" : undefined}
        aria-expanded={multiple ? open : undefined}
        title={multiple
          ? text(`${conversations.length} 个对话`, `${conversations.length} conversations`)
          : singleAgentSession
            ? `${singlePlatformLabel}: ${sessionResumeCommand(singleAgentSession.platform, singleAgentSession.sessionId)}`
            : singlePlatformLabel
              ? `${singlePlatformLabel}: ${conversations[0].title}`
              : conversations[0].title}
        onPointerDown={stop}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          if (multiple) {
            setActionError(null);
            setOpen((current) => !current);
          }
          else openConversation(conversations[0]);
        }}
      >
        {singlePlatform === "codex" ? (
          <img className="task-conversation-platform-icon" src="/codex-agent-logo.png" alt="" aria-hidden="true" />
        ) : singlePlatform === "claude" ? (
          <svg className="task-conversation-platform-icon is-claude" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M5.29 5.29l3.54 3.54m6.34 6.34 3.54 3.54m0-13.42-3.54 3.54m-6.34 6.34-3.54 3.54" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          </svg>
        ) : <ConversationIcon color="currentColor" size={16} />}
        {multiple && <span>+{conversations.length}</span>}
        {singlePlatformLabel && <span>{singlePlatformLabel}</span>}
      </button>
      {open && multiple && createPortal(
        <div
          ref={menuRef}
          className="task-conversation-menu"
          role="menu"
          aria-label={text("选择对话", "Select conversation")}
          style={{
            left: position.left,
            top: position.top,
            visibility: position.ready ? "visible" : "hidden",
          }}
          onClick={stop}
        >
          <div className="task-conversation-menu-heading">{text("关联对话", "Linked conversations")}</div>
          {conversations.map((conversation) => (
            <button
              key={conversation.key}
              type="button"
              role="menuitem"
              title={conversation.agentSession
                ? sessionResumeCommand(conversation.agentSession.platform, conversation.agentSession.sessionId)
                : undefined}
              onClick={() => openConversation(conversation)}
            >
              <span className="task-conversation-menu-icon">
                <ConversationIcon color="currentColor" size={13} />
              </span>
              <span className="task-conversation-menu-copy">
                <strong>{conversation.title}</strong>
                <small>{conversationSource(conversation, text)}</small>
              </span>
              <span className={`task-conversation-menu-status${conversation.currentRun?.status === "running" ? " is-running" : ""}`}>
                {conversationStatus(conversation, text)}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

import React from 'react';
import type { UIMessage } from '../../types/domain.js';

type PixelAgentState = 'idle' | 'waiting' | 'thinking' | 'speaking' | 'blocked';
type SpriteColumn = 'idle' | 'thinking' | 'typing' | 'reviewing' | 'approved' | 'blocked' | 'interrupted' | 'presenting';
export type PixelAgentViewMode = 'animated' | 'classic';

interface PixelAgentStageProps {
  title: string;
  agents: any[];
  selectedAgentNames: string[];
  messages: UIMessage[];
  loading: boolean;
  activeRunId?: string | null;
  compact?: boolean;
  fill?: boolean;
  viewMode: PixelAgentViewMode;
  onViewModeChange: (mode: PixelAgentViewMode) => void;
}

const SPRITE_FRAME_WIDTH = 32;
const SPRITE_FRAME_HEIGHT = 48;

const SPRITE_ROWS = [
  'architect',
  'developer',
  'reviewer',
  'moderator',
  'researcher',
  'analyst',
  'designer',
  'writer',
  'legal',
  'finance',
  'operations',
  'sales',
  'marketing',
  'product_manager',
  'customer_support',
  'qa_auditor'
] as const;

const MEETING_ROOM_BACKGROUND = '/assets/pixel-meeting-rooms/standing-meeting-room-v2.png';
const MEETING_ROOM_FOREGROUND = '/assets/pixel-meeting-rooms/standing-meeting-room-v2-foreground.png';

const MEETING_ROOM_ANCHORS = [
  { x: 30.7, y: 62.8, scale: 1.36, facing: 1, pose: 'stand', z: 560 },
  { x: 40, y: 58.6, scale: 1.32, facing: 1, pose: 'stand', z: 520 },
  { x: 50, y: 56.8, scale: 1.3, facing: -1, pose: 'stand', z: 500 },
  { x: 60, y: 58.6, scale: 1.32, facing: -1, pose: 'stand', z: 520 },
  { x: 69.3, y: 62.8, scale: 1.36, facing: -1, pose: 'stand', z: 560 },
  { x: 24.6, y: 73.6, scale: 1.43, facing: 1, pose: 'stand', z: 640 },
  { x: 34.4, y: 77.8, scale: 1.48, facing: 1, pose: 'stand', z: 690 },
  { x: 44.9, y: 79.8, scale: 1.5, facing: 1, pose: 'stand', z: 710 },
  { x: 55.1, y: 79.8, scale: 1.5, facing: -1, pose: 'stand', z: 712 },
  { x: 65.6, y: 77.8, scale: 1.48, facing: -1, pose: 'stand', z: 690 },
  { x: 75.4, y: 73.6, scale: 1.43, facing: -1, pose: 'stand', z: 640 },
  { x: 18, y: 70.8, scale: 1.38, facing: 1, pose: 'stand', z: 620 },
  { x: 82, y: 70.8, scale: 1.38, facing: -1, pose: 'stand', z: 620 },
  { x: 30.1, y: 86.5, scale: 1.52, facing: 1, pose: 'stand', z: 760 },
  { x: 50, y: 87.5, scale: 1.55, facing: 1, pose: 'stand', z: 780 },
  { x: 69.9, y: 86.5, scale: 1.52, facing: -1, pose: 'stand', z: 760 }
];

const FOCUSED_ROOM_ANCHORS = [
  { x: 43.5, y: 73.5, scale: 2.05, facing: 1, pose: 'stand', z: 650 },
  { x: 50, y: 70.5, scale: 1.98, facing: -1, pose: 'stand', z: 620 },
  { x: 56.5, y: 73.5, scale: 2.05, facing: -1, pose: 'stand', z: 650 }
];

const SMALL_ROOM_ANCHORS = [
  { x: 37.5, y: 69, scale: 1.75, facing: 1, pose: 'stand', z: 610 },
  { x: 46, y: 65.5, scale: 1.68, facing: 1, pose: 'stand', z: 570 },
  { x: 54, y: 65.5, scale: 1.68, facing: -1, pose: 'stand', z: 570 },
  { x: 62.5, y: 69, scale: 1.75, facing: -1, pose: 'stand', z: 610 },
  { x: 43.5, y: 78, scale: 1.86, facing: 1, pose: 'stand', z: 700 },
  { x: 56.5, y: 78, scale: 1.86, facing: -1, pose: 'stand', z: 700 }
];

function resolveRoomLayout(agentCount: number): { anchors: typeof MEETING_ROOM_ANCHORS; zoom: number; density: string } {
  if (agentCount <= 3) {
    return { anchors: FOCUSED_ROOM_ANCHORS, zoom: 1.6, density: 'focused' };
  }

  if (agentCount <= 6) {
    return { anchors: SMALL_ROOM_ANCHORS, zoom: 1.36, density: 'small' };
  }

  if (agentCount <= 10) {
    return { anchors: MEETING_ROOM_ANCHORS.slice(0, 11), zoom: 1.1, density: 'medium' };
  }

  return { anchors: MEETING_ROOM_ANCHORS, zoom: 1, density: 'full' };
}

function normalizeName(value: unknown): string {
  return String(value || '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim()
    .toLowerCase();
}

function normalizeToken(value: unknown): string {
  return normalizeName(value).replace(/[^a-z0-9]+/g, ' ');
}

function isMessageForAgent(message: UIMessage, agentName: string): boolean {
  const normalizedAgentName = normalizeName(agentName);
  return normalizeName(message.role) === normalizedAgentName
    || normalizeName(message.author) === normalizedAgentName;
}

function latestAgentMessage(messages: UIMessage[]): UIMessage | undefined {
  return [...messages].reverse().find(message => message.role !== 'system' && message.role !== 'user');
}

function latestMessageForAgent(messages: UIMessage[], agentName: string): UIMessage | undefined {
  return [...messages].reverse().find(message => isMessageForAgent(message, agentName));
}

function trimBubbleText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93)}...`;
}

function resolveAgentState(agentName: string, messages: UIMessage[], loading: boolean, activeRunId?: string | null): PixelAgentState {
  const latestForAgent = latestMessageForAgent(messages, agentName);
  if (latestForAgent?.streaming) return 'speaking';

  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.role === 'system' && /interrupt|failed|error/i.test(latestMessage.text)) {
    return 'blocked';
  }

  if (loading && activeRunId) {
    const latestAgentMessage = [...messages].reverse().find(message => message.role !== 'system' && message.role !== 'user');
    if (latestAgentMessage && isMessageForAgent(latestAgentMessage, agentName)) {
      return 'thinking';
    }
    return 'waiting';
  }

  return 'idle';
}

function resolveBubbleText(agentName: string, messages: UIMessage[], state: PixelAgentState): string | null {
  const latestForAgent = latestMessageForAgent(messages, agentName);
  if (latestForAgent?.streaming && latestForAgent.text.trim()) {
    return trimBubbleText(latestForAgent.text);
  }

  const latestFromAnyAgent = latestAgentMessage(messages);
  if (latestFromAnyAgent && latestForAgent === latestFromAnyAgent && latestForAgent.text.trim()) {
    return trimBubbleText(latestForAgent.text);
  }

  if (state === 'thinking') return 'Thinking...';
  return null;
}

function stateToSpriteColumn(state: PixelAgentState): SpriteColumn {
  switch (state) {
    case 'speaking':
      return 'typing';
    case 'thinking':
      return 'thinking';
    case 'blocked':
      return 'blocked';
    case 'waiting':
      return 'idle';
    default:
      return 'idle';
  }
}

function resolveFrameUrl(spriteRow: number, spriteColumn: SpriteColumn): string {
  return `/assets/pixel-agents/frames-v2/${SPRITE_ROWS[spriteRow]}-${spriteColumn}.png`;
}

function resolveEntryPosition(position: { x: number; y: number }): { x: number; y: number } {
  const entryOffset = position.x < 50 ? -18 : 18;
  return {
    x: Math.max(12, Math.min(88, position.x + entryOffset)),
    y: Math.max(56, Math.min(88, position.y + 5))
  };
}

function getStableIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function resolveSpriteRow(agent: any, fallbackIndex: number): number {
  const identity = `${normalizeToken(agent?.name)} ${normalizeToken(agent?.role)}`;
  const matches = (pattern: RegExp) => pattern.test(identity);

  let result = getStableIndex(agent?.name || '') % SPRITE_ROWS.length;

  if (matches(/\barchitect|architecture|system design\b/)) result = SPRITE_ROWS.indexOf('architect');
  else if (matches(/\bdeveloper|doer|implementer|implementation|coding|software\b/)) result = SPRITE_ROWS.indexOf('developer');
  else if (matches(/\bmoderator|facilitator|room moderator\b/)) result = SPRITE_ROWS.indexOf('moderator');
  else if (matches(/\bresearch|source|citation\b/)) result = SPRITE_ROWS.indexOf('researcher');
  else if (matches(/\bdesigner|design|ux|ui\b/)) result = SPRITE_ROWS.indexOf('designer');
  else if (matches(/\bwriter|reporter|editor|documentation|summary|screenwriter|story\b/)) result = SPRITE_ROWS.indexOf('writer');
  else if (matches(/\blegal|policy|compliance|contract|security\b/)) result = SPRITE_ROWS.indexOf('legal');
  else if (matches(/\bproduct|requirements|scope|priorit\b/)) result = SPRITE_ROWS.indexOf('product_manager');
  else if (matches(/\bqa|quality|auditor|test|validation\b/)) result = SPRITE_ROWS.indexOf('qa_auditor');
  else if (matches(/\breviewer|review|critique\b/)) result = SPRITE_ROWS.indexOf('reviewer');
  
  // Specific asset/trading subroles mapped before general analyst
  else if (matches(/\bcrypto|bitcoin|blockchain\b/)) result = SPRITE_ROWS.indexOf('finance');
  else if (matches(/\bfx|forex|commodit|commodity\b/)) result = SPRITE_ROWS.indexOf('operations');
  else if (matches(/\btrader|trading\b/)) result = SPRITE_ROWS.indexOf('sales');
  else if (matches(/\brisk|risk manager\b/)) result = SPRITE_ROWS.indexOf('legal');
  else if (matches(/\bmacro|strategist\b/)) result = SPRITE_ROWS.indexOf('researcher');
  else if (matches(/\btechnical\b/)) result = SPRITE_ROWS.indexOf('designer');
  
  else if (matches(/\banalyst|analysis\b/)) result = SPRITE_ROWS.indexOf('analyst');
  else if (matches(/\bfinance|budget|pricing|forecast|cost\b/)) result = SPRITE_ROWS.indexOf('finance');
  else if (matches(/\boperations|workflow|sop|logistics|producer\b/)) result = SPRITE_ROWS.indexOf('operations');
  else if (matches(/\bsales|pitch|customer|negotiation\b/)) result = SPRITE_ROWS.indexOf('sales');
  else if (matches(/\bmarketing|campaign|positioning|audience\b/)) result = SPRITE_ROWS.indexOf('marketing');
  else if (matches(/\bsupport|help|ticket|faq\b/)) result = SPRITE_ROWS.indexOf('customer_support');

  console.log(`[resolveSpriteRow] Agent: "${agent?.name}" | Role: "${agent?.role}" | Identity: "${identity}" | Sprite: ${SPRITE_ROWS[result]} (${result})`);
  return result;
}

interface RenderedAgent {
  name: string;
  agent: any;
  position: typeof MEETING_ROOM_ANCHORS[0] & { startX: number; startY: number };
  status: 'entering' | 'present' | 'leaving';
  index: number;
}

export const PixelAgentStage: React.FC<PixelAgentStageProps> = ({
  title,
  agents,
  selectedAgentNames,
  messages,
  loading,
  activeRunId,
  compact = false,
  fill = false,
  viewMode,
  onViewModeChange
}) => {
  const orderedAgents = React.useMemo(() => {
    return selectedAgentNames
      .map(name => agents.find(agent => normalizeName(agent.name) === normalizeName(name)) || { name, role: 'AI Member' })
      .filter((agent, index, list) => list.findIndex(item => normalizeName(item.name) === normalizeName(agent.name)) === index);
  }, [selectedAgentNames, agents]);

  const [renderedAgents, setRenderedAgents] = React.useState<RenderedAgent[]>([]);

  // Sync state when orderedAgents changes
  React.useEffect(() => {
    const activeNames = new Set(orderedAgents.map(a => normalizeName(a.name)));

    setRenderedAgents(prev => {
      const next: RenderedAgent[] = [];
      const newLayout = resolveRoomLayout(orderedAgents.length);

      // 1. Update/keep existing agents that are still active
      orderedAgents.forEach((agent, newIndex) => {
        const normName = normalizeName(agent.name);
        const prevAgent = prev.find(p => normalizeName(p.agent.name) === normName);

        const position = newLayout.anchors[newIndex % newLayout.anchors.length];
        const entryPosition = resolveEntryPosition(position);
        const posWithEntry = { ...position, startX: entryPosition.x, startY: entryPosition.y };

        if (prevAgent) {
          // If they were already present/entering, keep their state but update position/index
          next.push({
            name: agent.name,
            agent,
            position: posWithEntry,
            status: prevAgent.status === 'leaving' ? 'entering' : prevAgent.status,
            index: newIndex
          });
        } else {
          // New agent walking in
          next.push({
            name: agent.name,
            agent,
            position: posWithEntry,
            status: 'entering',
            index: newIndex
          });
        }
      });

      // 2. Identify agents that were present but are now removed, mark them as leaving
      prev.forEach(prevAgent => {
        const normName = normalizeName(prevAgent.agent.name);
        if (!activeNames.has(normName)) {
          // Keep it as leaving so it plays the exit animation
          next.push({
            ...prevAgent,
            status: 'leaving'
          });
        }
      });

      return next;
    });
  }, [orderedAgents]);

  // Clean up 'entering' agents
  React.useEffect(() => {
    const enteringAgents = renderedAgents.filter(a => a.status === 'entering');
    if (enteringAgents.length > 0) {
      const timer = window.setTimeout(() => {
        setRenderedAgents(prev =>
          prev.map(a => a.status === 'entering' ? { ...a, status: 'present' } : a)
        );
      }, 1600);
      return () => window.clearTimeout(timer);
    }
  }, [renderedAgents]);

  // Clean up 'leaving' agents (unmount them after animation finishes)
  React.useEffect(() => {
    const leavingAgents = renderedAgents.filter(a => a.status === 'leaving');
    if (leavingAgents.length > 0) {
      const timer = window.setTimeout(() => {
        setRenderedAgents(prev => prev.filter(a => a.status !== 'leaving'));
      }, 820); // 820ms matches the walk-out CSS animation duration
      return () => window.clearTimeout(timer);
    }
  }, [renderedAgents]);

  const activeAgentCount = renderedAgents.filter(a => a.status !== 'leaving').length;
  const roomLayout = resolveRoomLayout(activeAgentCount || orderedAgents.length);

  if (renderedAgents.length === 0) return null;

  return (
    <section
      className={`pixel-agent-stage ${compact ? 'compact' : ''} ${fill && viewMode === 'animated' ? 'fill' : ''} ${viewMode === 'classic' ? 'classic' : ''} density-${roomLayout.density}`}
      aria-label={title}
      style={{
        '--pixel-agent-scene': `url(${MEETING_ROOM_BACKGROUND})`,
        '--pixel-agent-scene-zoom': roomLayout.zoom,
        '--pixel-agent-scene-size': `${roomLayout.zoom * 100}% auto`
      } as React.CSSProperties}
    >
      <div className="pixel-agent-stage-header">
        <div>
          <div className="pixel-agent-stage-kicker">Pixel Agents</div>
          <div className="pixel-agent-stage-title">{title}</div>
        </div>
        <div className="pixel-agent-stage-status">
          {loading && activeRunId ? `Live: ${activeRunId}` : 'Ready'}
        </div>
        <div className="pixel-agent-mode-switch" aria-label="Pixel agent display mode">
          <button
            type="button"
            className={viewMode === 'animated' ? 'active' : ''}
            onClick={() => onViewModeChange('animated')}
          >
            Animated
          </button>
          <button
            type="button"
            className={viewMode === 'classic' ? 'active' : ''}
            onClick={() => onViewModeChange('classic')}
          >
            Classic
          </button>
        </div>
      </div>

      {viewMode === 'animated' && (
        <div className="pixel-agent-office" aria-label={`${title} animated office`}>
          {renderedAgents.map((agentState) => {
            const agent = agentState.agent;
            const state = resolveAgentState(agent.name, messages, loading, activeRunId);
            const spriteRow = resolveSpriteRow(agent, agentState.index);
            const spriteColumn = stateToSpriteColumn(state);
            const position = agentState.position;
            const bubbleText = agentState.status === 'leaving' ? null : resolveBubbleText(agent.name, messages, state);
            return (
              <div
                className={`pixel-agent-room-member ${agentState.status === 'entering' ? 'walk-in' : ''} ${agentState.status === 'leaving' ? 'walk-out' : ''} ${agentState.status === 'leaving' ? 'idle' : state} ${position.pose}`}
                key={agent.name}
                aria-label={`${agent.name}, ${agent.role || 'AI Member'}`}
                style={{
                  '--pixel-agent-x': `${position.x}%`,
                  '--pixel-agent-y': `${position.y}%`,
                  '--pixel-agent-start-x': `${position.startX}%`,
                  '--pixel-agent-start-y': `${position.startY}%`,
                  '--pixel-agent-scale': position.scale,
                  '--pixel-agent-facing': position.facing,
                  '--pixel-agent-z': position.z + agentState.index,
                  '--pixel-agent-bubble-bottom': `${Math.round(58 * position.scale) + 18}px`,
                  '--pixel-agent-walk-delay': agentState.status === 'leaving' ? '0ms' : `${Math.min(agentState.index, 7) * 90}ms`
                } as React.CSSProperties}
              >
                <div
                  className={`pixel-agent-character ${agentState.status === 'leaving' ? 'idle' : state}`}
                  aria-hidden="true"
                  style={{
                    '--pixel-agent-frame-width': `${SPRITE_FRAME_WIDTH}px`,
                    '--pixel-agent-frame-height': `${SPRITE_FRAME_HEIGHT}px`
                  } as React.CSSProperties}
                >
                  <img
                    alt=""
                    draggable={false}
                    src={resolveFrameUrl(spriteRow, spriteColumn)}
                  />
                </div>
                {bubbleText && (
                  <div className="pixel-agent-speech-bubble" aria-hidden="true">
                    {bubbleText}
                  </div>
                )}
                <span className="pixel-agent-state-cue" aria-hidden="true" />
              </div>
            );
          })}
          <img
            alt=""
            aria-hidden="true"
            className="pixel-agent-room-foreground"
            draggable={false}
            src={MEETING_ROOM_FOREGROUND}
          />
        </div>
      )}
    </section>
  );
};

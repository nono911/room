interface AppThemeStylesProps {
  contentTheme: string;
  contentFontFamily: string;
  contentFontSize: string;
  contentLineHeight: string;
}

const themeStyles: Record<string, string> = {
  ocean: `
    :root {
      --bg-app: 215 40% 4%;
      --bg-sidebar: 215 40% 6%;
      --bg-panel: 215 35% 8%;
      --bg-card: 215 30% 12%;
      --bg-input: 215 30% 10%;
      --accent-purple: 195 90% 50%;
      --accent-blue: 210 90% 55%;
      --glow-purple: rgba(34, 211, 238, 0.15);
      --border-glow: 195 80% 40% / 0.3;
      --border-focus: 210 90% 60% / 0.6;
    }
  `,
  forest: `
    :root {
      --bg-app: 140 30% 3%;
      --bg-sidebar: 140 30% 5%;
      --bg-panel: 140 25% 7%;
      --bg-card: 140 20% 11%;
      --bg-input: 140 20% 9%;
      --accent-purple: 142 70% 50%;
      --accent-blue: 84 70% 50%;
      --glow-purple: rgba(34, 197, 94, 0.15);
      --border-glow: 142 60% 40% / 0.3;
      --border-focus: 142 80% 50% / 0.6;
    }
  `,
  twilight: `
    :root {
      --bg-app: 280 40% 4%;
      --bg-sidebar: 280 40% 6%;
      --bg-panel: 280 35% 8%;
      --bg-card: 280 30% 12%;
      --bg-input: 280 30% 10%;
      --accent-purple: 295 85% 60%;
      --accent-blue: 320 85% 60%;
      --glow-purple: rgba(217, 70, 239, 0.15);
      --border-glow: 295 80% 50% / 0.3;
      --border-focus: 295 90% 65% / 0.6;
    }
  `,
  nord: `
    :root {
      --bg-app: 220 16% 12%;
      --bg-sidebar: 220 16% 14%;
      --bg-panel: 220 14% 17%;
      --bg-card: 220 12% 22%;
      --bg-input: 220 12% 19%;
      --accent-purple: 193 43% 67%;
      --accent-blue: 210 34% 63%;
      --glow-purple: rgba(136, 192, 208, 0.15);
      --border-glow: 193 40% 50% / 0.3;
      --border-focus: 210 40% 60% / 0.6;
    }
  `,
  cyberpunk: `
    :root {
      --bg-app: 0 0% 0%;
      --bg-sidebar: 0 0% 2%;
      --bg-panel: 0 0% 4%;
      --bg-card: 0 0% 9%;
      --bg-input: 0 0% 7%;
      --accent-purple: 24 95% 60%;
      --accent-blue: 180 100% 50%;
      --glow-purple: rgba(249, 115, 22, 0.15);
      --border-glow: 24 90% 50% / 0.4;
      --border-focus: 180 100% 50% / 0.6;
    }
  `
};

export function AppThemeStyles({
  contentTheme,
  contentFontFamily,
  contentFontSize,
  contentLineHeight
}: AppThemeStylesProps) {
  return (
    <style>{`
      ${themeStyles[contentTheme] || ''}
      .chat-bubble,
      .markdown-preview,
      .adr-preview,
      .focus-editor-card textarea,
      .focus-editor-card input,
      .focus-editor-card select,
      .task-list {
        font-family: ${contentFontFamily} !important;
        font-size: ${contentFontSize} !important;
        line-height: ${contentLineHeight} !important;
      }
      .message-markdown {
        color: inherit;
        overflow-wrap: anywhere;
      }
      .markdown-preview .message-markdown {
        padding: 20px 22px;
        max-width: 920px;
      }
      .message-markdown > :last-child {
        margin-bottom: 0 !important;
      }
      .message-markdown ul {
        display: flex;
        flex-direction: column;
        gap: 0.25em;
      }
      .message-markdown strong {
        color: hsl(var(--text-primary));
        font-weight: 700;
      }
      .message-markdown em {
        color: hsl(var(--text-secondary));
      }
      .message-markdown code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.86em;
        background: hsl(var(--bg-input));
        border: 1px solid hsl(var(--border-dim));
        border-radius: 5px;
        padding: 0.08em 0.32em;
      }
      .message-markdown pre code {
        background: transparent;
        border: 0;
        border-radius: 0;
        padding: 0;
      }
    `}</style>
  );
}

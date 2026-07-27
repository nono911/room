import type { WorkspaceFilePreview } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';

interface FilePreviewPaneProps {
  title: string | null;
  subtitle?: string;
  preview: WorkspaceFilePreview | null;
  loading: boolean;
  canReveal?: boolean;
  canAddContext?: boolean;
  onCopyPath?: () => void;
  onReveal?: () => void;
  onAddContext?: () => void;
}

function renderTextPreview(preview: Extract<WorkspaceFilePreview, { kind: 'text' }>) {
  if (preview.language === 'markdown') {
    return (
      <div className="unified-preview markdown-preview">
        {renderMarkdownContent(preview.content, false, 'message-markdown')}
      </div>
    );
  }
  if (preview.language === 'json') {
    try {
      const formatted = JSON.stringify(JSON.parse(preview.content), null, 2);
      return <pre className="unified-preview code-preview">{formatted}</pre>;
    } catch {
      return <pre className="unified-preview code-preview">{preview.content}</pre>;
    }
  }
  return <pre className="unified-preview code-preview">{preview.content}</pre>;
}

export function FilePreviewPane({
  title,
  subtitle,
  preview,
  loading,
  canReveal,
  canAddContext,
  onCopyPath,
  onReveal,
  onAddContext
}: FilePreviewPaneProps) {
  return (
    <section className="file-preview-pane">
      <header className="file-preview-header">
        <div className="file-preview-title">
          <span>{title || 'No file selected'}</span>
          <small>{subtitle || 'Choose a source file or ROOM artifact to preview it.'}</small>
        </div>
        {title && (
          <div className="file-preview-actions">
            {onCopyPath && <button type="button" onClick={onCopyPath}>Copy path</button>}
            {canReveal && onReveal && <button type="button" onClick={onReveal}>Reveal</button>}
            {canAddContext && onAddContext && <button type="button" className="primary" onClick={onAddContext}>Add context</button>}
          </div>
        )}
      </header>
      <div className="file-preview-body">
        {loading ? (
          <div className="file-preview-state">Loading preview…</div>
        ) : !preview ? (
          <div className="file-preview-state">
            <span className="file-preview-empty-icon">⌁</span>
            <strong>Open something worth reading</strong>
            <p>Browse the attached source or switch to ROOM artifacts. Your last selection is restored automatically.</p>
          </div>
        ) : preview.kind === 'image' ? (
          <div className="unified-preview media-preview">
            <img src={preview.dataUrl} alt={title || 'Source file preview'} />
          </div>
        ) : preview.kind === 'pdf' ? (
          <embed className="unified-preview pdf-preview" src={preview.dataUrl} type={preview.mimeType} />
        ) : preview.kind === 'binary' ? (
          <div className="file-preview-state">
            <span className="file-preview-empty-icon">◇</span>
            <strong>Preview unavailable</strong>
            <p>{preview.message}</p>
          </div>
        ) : renderTextPreview(preview)}
      </div>
    </section>
  );
}

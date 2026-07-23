import React from 'react';
import type { ProjectData } from '../../types/domain.js';

interface OverviewScreenProps {
  projectData: ProjectData | null;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({ projectData }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
        Active workspace overview located in ROOM Home.
      </div>
      <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
        {projectData?.projectMd || '# No project details loaded.'}
      </div>
    </div>
  );
};

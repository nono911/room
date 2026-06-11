import React from 'react';

interface ErrorBannerProps {
  errorMsg: string | null;
  onClear: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ errorMsg, onClear }) => {
  if (!errorMsg) return null;
  return (
    <div style={{
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      padding: '12px 16px',
      borderRadius: '8px',
      color: '#ef4444',
      fontSize: '0.85rem',
      marginBottom: '16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <span style={{ whiteSpace: 'pre-wrap' }}>{errorMsg}</span>
      <button
        onClick={onClear}
        style={{
          background: 'none',
          border: 'none',
          color: '#ef4444',
          cursor: 'pointer',
          fontWeight: 'bold',
          marginLeft: '12px',
          fontSize: '1rem',
          outline: 'none'
        }}
      >
        ✕
      </button>
    </div>
  );
};

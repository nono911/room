import React from 'react';
import { useProviders } from '../context/ProvidersContext.js';
import { PROVIDER_PRESETS } from '../../../shared/data/staticData.js';

interface SettingsScreenProps {
  loading: boolean;
  contentTheme: string;
  setContentTheme: (theme: string) => void;
  contentFontFamily: string;
  setContentFontFamily: (fontFamily: string) => void;
  contentFontSize: string;
  setContentFontSize: (fontSize: string) => void;
  contentLineHeight: string;
  setContentLineHeight: (lineHeight: string) => void;
  projectAgents: any[];
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  loading,
  contentTheme,
  setContentTheme,
  contentFontFamily,
  setContentFontFamily,
  contentFontSize,
  setContentFontSize,
  contentLineHeight,
  setContentLineHeight,
  projectAgents
}) => {
  const {
    providers,
    providerKeyDrafts,
    setProviderKeyDrafts,
    providerTestResults,
    addProviderOpen,
    setAddProviderOpen,
    addProviderDraft,
    setAddProviderDraft,
    handleSaveProviderKey,
    handleClearProviderKey,
    handleAddProvider,
    handleDeleteProvider,
    handleTestProvider
  } = useProviders();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
      {/* Section 0: AI Providers */}
      <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-green))', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H3v-4l6.257-6.257A6 6 0 1121 9z" />
            </svg>
            AI Providers
          </h4>
          <button type="button" className="btn-secondary" onClick={() => setAddProviderOpen(true)} disabled={loading} style={{ height: '32px', padding: '0 14px', fontSize: '0.78rem' }}>
            + Add Provider
          </button>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5 }}>
          Keys are stored locally on this machine in private app data, outside Room and Source files. Any OpenAI-compatible endpoint can be added. Leave a key field blank to keep the existing key.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {providers.map(provider => (
            <div key={provider.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid hsl(var(--border-dim))', borderRadius: '10px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <label style={{ fontSize: '0.84rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>{provider.label}</label>
                  {provider.baseUrl && (
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.baseUrl}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{
                    fontSize: '0.68rem',
                    color: provider.hasKey ? '#10b981' : 'hsl(var(--text-muted))',
                    background: provider.hasKey ? 'rgba(16, 185, 129, 0.1)' : 'hsl(var(--bg-input))',
                    border: provider.hasKey ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid hsl(var(--border-dim))',
                    borderRadius: '10px',
                    padding: '2px 7px',
                    whiteSpace: 'nowrap'
                  }}>
                    {provider.hasKey ? 'Configured' : 'No key'}
                  </span>
                  <button type="button" className="btn-secondary" onClick={() => handleTestProvider(provider.id)} disabled={loading} style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem' }}>
                    Test
                  </button>
                  {!provider.builtIn && (
                    <button type="button" className="btn-secondary" onClick={() => handleDeleteProvider(provider.id, projectAgents)} disabled={loading} style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem' }}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  value={providerKeyDrafts[provider.id] || ''}
                  disabled={loading}
                  onChange={(e) => setProviderKeyDrafts(prev => ({ ...prev, [provider.id]: e.target.value }))}
                  placeholder={provider.hasKey ? 'Configured. Enter a new key to replace.' : 'Paste API key (optional for local endpoints)'}
                  style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontFamily: 'inherit', fontSize: '0.84rem', outline: 'none', flex: 1 }}
                />
                <button type="button" className="btn-primary" onClick={() => handleSaveProviderKey(provider.id)} disabled={loading || !(providerKeyDrafts[provider.id] || '').trim()} style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem' }}>
                  Save Key
                </button>
                {provider.hasKey && (
                  <button type="button" className="btn-secondary" onClick={() => handleClearProviderKey(provider.id)} disabled={loading} style={{ height: '34px', padding: '0 12px', fontSize: '0.76rem' }}>
                    Clear Key
                  </button>
                )}
              </div>
              {providerTestResults[provider.id] && (
                <span style={{ fontSize: '0.72rem', color: providerTestResults[provider.id].ok ? '#10b981' : '#f87171' }}>
                  {providerTestResults[provider.id].message}
                </span>
              )}
              {provider.baseUrl?.startsWith('http://') && !provider.baseUrl.includes('localhost') && !provider.baseUrl.includes('127.0.0.1') && (
                <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>Warning: unencrypted http:// endpoint.</span>
              )}
            </div>
          ))}
        </div>
        {addProviderOpen && (
          <div style={{ border: '1px solid hsl(var(--border-dim))', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Add Provider</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {PROVIDER_PRESETS.filter(preset => !providers.some(provider => provider.id === preset.id)).map(preset => (
                <button key={preset.id} type="button" className="btn-secondary" style={{ height: '30px', padding: '0 12px', fontSize: '0.74rem' }}
                  onClick={() => setAddProviderDraft({ id: preset.id, label: preset.label, baseUrl: preset.baseUrl, apiKey: '' })}>
                  {preset.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input type="text" placeholder="id (e.g. groq)" value={addProviderDraft.id} disabled={loading}
                onChange={(e) => setAddProviderDraft(prev => ({ ...prev, id: e.target.value }))}
                style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none' }} />
              <input type="text" placeholder="Display name" value={addProviderDraft.label} disabled={loading}
                onChange={(e) => setAddProviderDraft(prev => ({ ...prev, label: e.target.value }))}
                style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none' }} />
              <input type="text" placeholder="Base URL (https://.../v1)" value={addProviderDraft.baseUrl} disabled={loading}
                onChange={(e) => setAddProviderDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
                style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none', gridColumn: '1 / -1' }} />
              <input type="password" placeholder="API key (optional)" value={addProviderDraft.apiKey} disabled={loading}
                onChange={(e) => setAddProviderDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none', gridColumn: '1 / -1' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="btn-secondary" onClick={() => { setAddProviderOpen(false); setAddProviderDraft({ id: '', label: '', baseUrl: '', apiKey: '' }); }} style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem' }}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleAddProvider}
                disabled={loading || !addProviderDraft.id.trim() || !addProviderDraft.baseUrl.trim()}
                style={{ height: '34px', padding: '0 16px', fontSize: '0.76rem' }}>
                Add Provider
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 1: Room execution settings */}
      <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-purple))', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Source Scanner
        </h4>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'hsl(var(--text-muted))', lineHeight: 1.6 }}>
          ROOM uses its deterministic, read-only scanner for the active Source. Local CLI scanners stay disabled until ROOM can confine reads to the Source at the operating-system boundary.
        </p>
      </div>

      {/* Section 2: Custom Visual Theme (Entire App) */}
      <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-blue))', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-3M9.7 9.3L14.5 4.5a1.5 1.5 0 012.1 2.1l-4.8 4.8m-2.1-2.1h.01M9.7 9.3v.01" /></svg>
          Room Color Theme (Entire App)
        </h4>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '16px' }}>
          {[
            { id: 'default', name: 'Midnight Slate', colors: ['#090d16', '#8b5cf6', '#f97316'] },
            { id: 'ocean', name: 'Ocean Midnight', colors: ['#040a12', '#22d3ee', '#3b82f6'] },
            { id: 'forest', name: 'Forest Dark', colors: ['#050d08', '#22c55e', '#eab308'] },
            { id: 'twilight', name: 'Twilight Plum', colors: ['#0c0612', '#d946ef', '#ec4899'] },
            { id: 'nord', name: 'Nord Freeze', colors: ['#1a2130', '#88c0d0', '#81a1c1'] },
            { id: 'cyberpunk', name: 'Cyberpunk Noir', colors: ['#000000', '#f97316', '#06b6d4'] }
          ].map(theme => {
            const isActive = contentTheme === theme.id;
            return (
              <div
                key={theme.id}
                onClick={() => {
                  setContentTheme(theme.id);
                  localStorage.setItem('room_theme', theme.id);
                }}
                style={{
                  border: isActive ? '2px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '12px',
                  cursor: 'pointer',
                  background: 'hsl(var(--bg-input))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 0 12px hsl(var(--accent-purple) / 0.15)' : 'none'
                }}
              >
                <div style={{ display: 'flex', gap: '6px' }}>
                  {theme.colors.map((c, i) => (
                    <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: c, border: '1px solid rgba(255,255,255,0.1)' }} />
                  ))}
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 500, color: isActive ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))' }}>
                  {theme.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Content Typography */}
      <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-orange))', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" /></svg>
          Content Typography (Chat & Markdown)
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Font Family</label>
            <select
              className="form-select"
              value={contentFontFamily}
              onChange={(e) => {
                setContentFontFamily(e.target.value);
                localStorage.setItem('room_font_family', e.target.value);
              }}
              style={{ width: '100%' }}
            >
              <option value="system-ui">System UI (Default)</option>
              <option value="'Inter', sans-serif">Inter</option>
              <option value="'Outfit', sans-serif">Outfit</option>
              <option value="Georgia, serif">Georgia (Serif)</option>
              <option value="monospace">Monospace (Code)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Font Size</label>
            <select
              className="form-select"
              value={contentFontSize}
              onChange={(e) => {
                setContentFontSize(e.target.value);
                localStorage.setItem('room_font_size', e.target.value);
              }}
              style={{ width: '100%' }}
            >
              <option value="13px">Small (13px)</option>
              <option value="14px">Compact (14px)</option>
              <option value="16px">Normal (16px)</option>
              <option value="18px">Medium (18px)</option>
              <option value="20px">Large (20px)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Line Height</label>
            <select
              className="form-select"
              value={contentLineHeight}
              onChange={(e) => {
                setContentLineHeight(e.target.value);
                localStorage.setItem('room_line_height', e.target.value);
              }}
              style={{ width: '100%' }}
            >
              <option value="1.4">Comfortable (1.4)</option>
              <option value="1.6">Relaxed (1.6)</option>
              <option value="1.8">Spacious (1.8)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { MaskedProvider, DetectedAgent } from '../../../types/domain.js';
import { api } from '../../../shared/ipc/client.js';
import { normalizeProviderId } from '../../../shared/data/staticData.js';
import { getFallbackModels } from '@room/engine/modelCatalog';

interface ModelOption {
  value: string;
  label: string;
}

interface ProvidersContextType {
  providers: MaskedProvider[];
  detectedClis: DetectedAgent[];
  dynamicCliModels: Record<string, ModelOption[]>;
  providerKeyDrafts: Record<string, string>;
  setProviderKeyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  providerTestResults: Record<string, { ok: boolean; message: string }>;
  addProviderOpen: boolean;
  setAddProviderOpen: (open: boolean) => void;
  addProviderDraft: { id: string; label: string; baseUrl: string; apiKey: string };
  setAddProviderDraft: React.Dispatch<React.SetStateAction<{ id: string; label: string; baseUrl: string; apiKey: string }>>;
  
  refreshProviders: () => Promise<void>;
  scanClis: () => Promise<void>;
  handleSaveProviderKey: (providerId: string) => Promise<void>;
  handleClearProviderKey: (providerId: string) => Promise<void>;
  handleAddProvider: () => Promise<void>;
  handleDeleteProvider: (providerId: string, projectAgents: any[]) => Promise<void>;
  handleTestProvider: (providerId: string) => Promise<void>;
  getModelOptions: (provider: string, preset?: string) => ModelOption[];
  fetchModelsForProvider: (provider: string, preset?: string) => Promise<void>;
}

const ProvidersContext = createContext<ProvidersContextType | undefined>(undefined);

export const ProvidersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [providers, setProviders] = useState<MaskedProvider[]>([]);
  const [detectedClis, setDetectedClis] = useState<DetectedAgent[]>([]);
  const [dynamicCliModels, setDynamicCliModels] = useState<Record<string, ModelOption[]>>({});
  const [providerKeyDrafts, setProviderKeyDrafts] = useState<Record<string, string>>({});
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [addProviderOpen, setAddProviderOpen] = useState<boolean>(false);
  const [addProviderDraft, setAddProviderDraft] = useState({ id: '', label: '', baseUrl: '', apiKey: '' });

  const refreshProviders = async () => {
    try {
      const res = await api.loadProviders();
      if (res.success && res.providers) {
        setProviders(res.providers);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  };

  const scanClis = async () => {
    try {
      const res = await api.detectLocalAgents();
      if (res.success && res.agents) {
        setDetectedClis(res.agents);
      }
    } catch (err) {
      console.error('Failed to detect local agents:', err);
    }
  };

  useEffect(() => {
    refreshProviders();
    scanClis();
  }, []);

  const handleSaveProviderKey = async (providerId: string) => {
    const draft = (providerKeyDrafts[providerId] || '').trim();
    if (!draft) return;
    try {
      const res = await api.saveProvider({ id: providerId, apiKey: draft });
      if (res.success && res.providers) {
        setProviders(res.providers);
        setProviderKeyDrafts(prev => ({ ...prev, [providerId]: '' }));
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to save provider key');
    }
  };

  const handleClearProviderKey = async (providerId: string) => {
    if (!window.confirm('Remove the stored API key for this provider?')) return;
    try {
      const res = await api.saveProvider({ id: providerId, apiKey: null });
      if (res.success && res.providers) {
        setProviders(res.providers);
        setProviderKeyDrafts(prev => ({ ...prev, [providerId]: '' }));
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to clear provider key');
    }
  };

  const handleAddProvider = async () => {
    const id = addProviderDraft.id.trim().toLowerCase();
    try {
      const res = await api.saveProvider({
        id,
        label: addProviderDraft.label.trim() || id,
        baseUrl: addProviderDraft.baseUrl.trim(),
        apiKey: addProviderDraft.apiKey.trim() || undefined
      });
      if (res.success && res.providers) {
        setProviders(res.providers);
        setAddProviderOpen(false);
        setAddProviderDraft({ id: '', label: '', baseUrl: '', apiKey: '' });
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to add provider');
    }
  };

  const handleDeleteProvider = async (providerId: string, projectAgents: any[]) => {
    const usedBy = (projectAgents || []).filter((agent: any) => normalizeProviderId(agent.provider) === providerId).map((agent: any) => agent.name);
    const detail = usedBy.length > 0
      ? `\n\nUsed by: ${usedBy.join(', ')}. These members will fall back to Gemini until reassigned.`
      : '';
    if (!window.confirm(`Remove this provider?${detail}`)) return;
    try {
      const res = await api.deleteProvider(providerId);
      if (res.success && res.providers) {
        setProviders(res.providers);
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete provider');
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setProviderTestResults(prev => ({ ...prev, [providerId]: { ok: true, message: 'Testing...' } }));
    try {
      const res = await api.testProvider(providerId);
      setProviderTestResults(prev => ({
        ...prev,
        [providerId]: res.success ? { ok: true, message: res.message || 'OK' } : { ok: false, message: res.error || 'Failed' }
      }));
    } catch (err: any) {
      setProviderTestResults(prev => ({
        ...prev,
        [providerId]: { ok: false, message: err.message || 'Error' }
      }));
    }
  };

  const fetchModelsForProvider = async (provider: string, preset?: string) => {
    if (provider === 'Local CLI') {
      void preset;
      return;
    } else {
      if (!provider || dynamicCliModels[provider]) return;
      try {
        const res = await api.detectApiModels(normalizeProviderId(provider));
        if (res.success && res.models && res.models.length > 0) {
          const models = res.models;
          setDynamicCliModels(prev => ({ ...prev, [provider]: models }));
        }
      } catch (err) {
        console.error(`Failed to fetch models for provider ${provider}:`, err);
      }
    }
  };

  const getModelOptions = (provider: string, preset?: string) => {
    if (provider === 'Local CLI') {
      if (preset && dynamicCliModels[preset]?.length > 0) {
        return dynamicCliModels[preset];
      }
      if (preset && preset !== 'none') {
        return getFallbackModels(preset as Parameters<typeof getFallbackModels>[0]) as ModelOption[];
      }
      return [];
    }

    if (dynamicCliModels[provider] && dynamicCliModels[provider].length > 0) {
      return dynamicCliModels[provider];
    }

    const id = normalizeProviderId(provider);
    const fallbackKey = ({ gemini: 'Gemini', anthropic: 'Claude', openai: 'Codex' } as Record<string, string>)[id];
    if (fallbackKey) {
      return getFallbackModels(fallbackKey as any) as ModelOption[];
    }
    return [];
  };

  return (
    <ProvidersContext.Provider value={{
      providers,
      detectedClis,
      dynamicCliModels,
      providerKeyDrafts,
      setProviderKeyDrafts,
      providerTestResults,
      addProviderOpen,
      setAddProviderOpen,
      addProviderDraft,
      setAddProviderDraft,
      refreshProviders,
      scanClis,
      handleSaveProviderKey,
      handleClearProviderKey,
      handleAddProvider,
      handleDeleteProvider,
      handleTestProvider,
      getModelOptions,
      fetchModelsForProvider
    }}>
      {children}
    </ProvidersContext.Provider>
  );
};

export const useProviders = () => {
  const context = useContext(ProvidersContext);
  if (!context) {
    throw new Error('useProviders must be used within a ProvidersProvider');
  }
  return context;
};

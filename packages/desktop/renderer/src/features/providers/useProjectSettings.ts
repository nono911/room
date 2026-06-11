import { useState } from 'react';
import type { ProjectConfigState } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';

interface UseProjectSettingsDeps {
  projectPath: string | null;
}

export function useProjectSettings({ projectPath }: UseProjectSettingsDeps) {
  const [projectConfig, setProjectConfig] = useState<ProjectConfigState>({ mainAgent: 'none', allowDangerousCli: false });

  const loadProjectConfig = async (pathStr: string) => {
    try {
      const configRes = await api.loadProjectConfig(pathStr);
      if (configRes.success && configRes.config) {
        setProjectConfig({
          mainAgent: configRes.config.mainAgent || 'none',
          modelName: configRes.config.modelName,
          allowDangerousCli: !!configRes.config.allowDangerousCli
        });
      }
    } catch (err) {
      console.error('Error loading project configuration:', err);
    }
  };

  const handleUpdateProjectConfig = async (key: keyof ProjectConfigState, value: string | boolean) => {
    if (!projectPath) return;
    const newConfig: ProjectConfigState = { ...projectConfig, [key]: value };
    if (key === 'mainAgent') {
      newConfig.modelName = '';
      newConfig.allowDangerousCli = false;
    }
    setProjectConfig(newConfig);
    try {
      await api.saveProjectConfig(projectPath, newConfig);
      if (key === 'mainAgent' && typeof value === 'string' && value !== 'none') {
        const res = await api.detectCliModels(value);
        if (res.success && res.models && res.models.length > 0) {
          const models = res.models;
          const updatedConfig = { ...newConfig, modelName: models[0].value };
          setProjectConfig(updatedConfig);
          await api.saveProjectConfig(projectPath, updatedConfig);
        }
      }
    } catch (err) {
      console.error('Failed to save project settings:', err);
    }
  };

  return {
    projectConfig,
    setProjectConfig,
    loadProjectConfig,
    handleUpdateProjectConfig
  };
}

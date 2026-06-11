import { api } from '../../shared/ipc/client.js';

type RoomFilePreviewSection = 'skills' | 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions';
type InitialSelectedFile = {
  section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions';
  file: string;
};

interface UseRoomFilePreviewOptions {
  projectPath: string | null;
  setInitialSelectedFile: (value: InitialSelectedFile | null) => void;
  setEditingSkillFile: (value: string) => void;
  setEditingSkillContent: (value: string) => void;
  setEditingSkillSource: (value: 'skills' | 'roles') => void;
  setLoading: (value: boolean) => void;
  setErrorMsg: (value: string | null) => void;
}

export function useRoomFilePreview({
  projectPath,
  setInitialSelectedFile,
  setEditingSkillFile,
  setEditingSkillContent,
  setEditingSkillSource,
  setLoading,
  setErrorMsg
}: UseRoomFilePreviewOptions) {
  const loadRoomFilePreview = async (
    section: RoomFilePreviewSection,
    filename: string
  ) => {
    if (!projectPath || !filename) return;
    if (section === 'skills') {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await api.readRoomFile(projectPath, section, filename);
        if (!res.success) {
          setErrorMsg(res.error || `Failed to load ${filename}.`);
          return;
        }
        setEditingSkillFile(filename);
        setEditingSkillContent(res.content || '');
        setEditingSkillSource(res.sourceSection === 'roles' ? 'roles' : 'skills');
      } catch (err: any) {
        setErrorMsg(err.message || `Failed to load ${filename}.`);
      } finally {
        setLoading(false);
      }
    } else {
      setInitialSelectedFile({ section, file: filename });
    }
  };

  return {
    loadRoomFilePreview
  };
}

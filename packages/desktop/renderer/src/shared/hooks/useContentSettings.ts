import { useState } from 'react';

export function useContentSettings() {
  const [contentTheme, setContentTheme] = useState<string>(() => localStorage.getItem('room_theme') || 'default');
  const [contentFontFamily, setContentFontFamily] = useState<string>(() => localStorage.getItem('room_font_family') || 'system-ui');
  const [contentFontSize, setContentFontSize] = useState<string>(() => localStorage.getItem('room_font_size') || '16px');
  const [contentLineHeight, setContentLineHeight] = useState<string>(() => localStorage.getItem('room_line_height') || '1.6');

  return {
    contentTheme,
    setContentTheme,
    contentFontFamily,
    setContentFontFamily,
    contentFontSize,
    setContentFontSize,
    contentLineHeight,
    setContentLineHeight
  };
}

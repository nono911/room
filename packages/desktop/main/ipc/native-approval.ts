import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';

export async function confirmNativeApproval(
  event: IpcMainInvokeEvent,
  title: string,
  message: string,
  detail: string
): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    title,
    message,
    detail,
    buttons: ['Allow', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

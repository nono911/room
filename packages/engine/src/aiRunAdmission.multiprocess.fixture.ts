import { withAiRunAdmission } from './aiRunAdmission.js';

const [, , roomRoot, roomId, operationId, holdMsRaw] = process.argv;
if (!roomRoot || !roomId || !operationId || !holdMsRaw) {
  throw new Error('Room root, Room id, operation id, and hold duration are required.');
}
const holdMs = Number(holdMsRaw);
await withAiRunAdmission({ roomRoot, roomId }, operationId, async () => {
  process.stdout.write('ACQUIRED\n');
  await new Promise(resolve => setTimeout(resolve, holdMs));
});

const MAX_CONCURRENT_ROOM_SEARCHES = 2;
const activeRoomSearches = new Map<string, number>();

export async function withContextSearchAdmission<T>(
  roomId: string,
  search: () => Promise<T>
): Promise<T> {
  const active = activeRoomSearches.get(roomId) || 0;
  if (active >= MAX_CONCURRENT_ROOM_SEARCHES) {
    throw new Error('Too many active context searches for this Room.');
  }
  activeRoomSearches.set(roomId, active + 1);
  try {
    return await search();
  } finally {
    const remaining = (activeRoomSearches.get(roomId) || 1) - 1;
    if (remaining === 0) activeRoomSearches.delete(roomId);
    else activeRoomSearches.set(roomId, remaining);
  }
}

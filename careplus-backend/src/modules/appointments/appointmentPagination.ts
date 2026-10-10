export function getUpcomingPastPage(limit: number, skip: number, upcomingCount: number) {
  const upcomingTake = Math.max(0, Math.min(limit, upcomingCount - skip));
  const pastTake = limit - upcomingTake;
  const pastSkip = Math.max(0, skip - upcomingCount);

  return { upcomingSkip: skip, upcomingTake, pastSkip, pastTake };
}
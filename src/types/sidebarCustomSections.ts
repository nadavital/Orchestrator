export interface SidebarCustomSectionLike {
  id: string
  sessionIds: string[]
}

export function moveSessionToSidebarCustomSection<TSection extends SidebarCustomSectionLike>(
  sections: readonly TSection[],
  sectionId: string,
  sessionId: string,
  beforeSessionId?: string | null
): TSection[] {
  if (!sections.some((section) => section.id === sectionId) || !sessionId) return [...sections]

  return sections.map((section) => {
    const withoutSession = section.sessionIds.filter((id) => id !== sessionId)
    if (section.id !== sectionId) return { ...section, sessionIds: withoutSession }

    const insertIndex = beforeSessionId == null
      ? withoutSession.length
      : withoutSession.indexOf(beforeSessionId)
    const nextIds = [...withoutSession]
    nextIds.splice(insertIndex >= 0 ? insertIndex : nextIds.length, 0, sessionId)
    return { ...section, sessionIds: nextIds }
  })
}

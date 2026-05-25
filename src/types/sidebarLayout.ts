export type OrderedSidebarProjectGroup<TProjectless, TProject> =
  | { kind: 'projectless'; item: TProjectless }
  | { kind: 'project'; item: TProject }

export function orderProjectlessSidebarGroups<TProjectless, TProject>(
  projectlessGroups: readonly TProjectless[],
  projectGroups: readonly TProject[],
  projectlessChatsFirst: boolean
): OrderedSidebarProjectGroup<TProjectless, TProject>[] {
  const projectless = projectlessGroups.map((item): OrderedSidebarProjectGroup<TProjectless, TProject> => ({ kind: 'projectless', item }))
  const projects = projectGroups.map((item): OrderedSidebarProjectGroup<TProjectless, TProject> => ({ kind: 'project', item }))
  return projectlessChatsFirst ? [...projectless, ...projects] : [...projects, ...projectless]
}

export function moveSidebarSectionKey<TSectionKey extends string>(
  sectionOrder: readonly TSectionKey[],
  sectionKey: TSectionKey,
  beforeSectionKey?: TSectionKey | null
): TSectionKey[] {
  if (!sectionOrder.includes(sectionKey)) return [...sectionOrder]
  const withoutSection = sectionOrder.filter((candidate) => candidate !== sectionKey)
  const insertIndex = beforeSectionKey == null
    ? withoutSection.length
    : withoutSection.indexOf(beforeSectionKey)
  const next = [...withoutSection]
  next.splice(insertIndex >= 0 ? insertIndex : next.length, 0, sectionKey)
  return next
}

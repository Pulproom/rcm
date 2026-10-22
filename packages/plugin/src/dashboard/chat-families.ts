/** A chat that inherited from another visible chat sits in that chat's family; everything else is a root. */
export interface ChatFamilyMember<T> { chat: T; parent?: T }
export interface ChatFamily<T> { root: T; members: Array<ChatFamilyMember<T>> }

type FamilyChat = { id: string; updatedAt?: number; chatTitle?: string; lineage?: { status?: string; parentChatId?: string; forkOrdinal?: number } };

const parentId = (chat: FamilyChat): string | undefined => chat.lineage?.status === "inherited" ? chat.lineage.parentChatId : undefined;

/**
 * Groups chats into families of one root and every descendant, in tree order (each child right after its parent's
 * subtree starts, siblings by fork point then title). Depth is not kept on purpose: the view indents one level and
 * names the parent instead, so long chains never push rows sideways. Families with the current chat come first,
 * then the most recently updated.
 */
export function chatFamilies<T extends FamilyChat>(chats: T[], currentChatId?: string): Array<ChatFamily<T>> {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const chat of chats) {
    const parent = parentId(chat);
    if (parent && parent !== chat.id && byId.has(parent)) children.set(parent, [...children.get(parent) ?? [], chat]);
    else roots.push(chat);
  }
  const order = (left: T, right: T) => Number(left.lineage?.forkOrdinal ?? 0) - Number(right.lineage?.forkOrdinal ?? 0)
    || String(left.chatTitle ?? "").localeCompare(String(right.chatTitle ?? ""), ["ko", "en"], { numeric: true });
  const families = roots.map((root) => {
    const members: Array<ChatFamilyMember<T>> = [];
    const seen = new Set<string>([root.id]);
    const walk = (node: T) => {
      for (const child of [...children.get(node.id) ?? []].sort(order)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        members.push({ chat: child, parent: node });
        walk(child);
      }
    };
    walk(root);
    return { root, members };
  });
  const latest = (family: ChatFamily<T>) => Math.max(Number(family.root.updatedAt ?? 0), ...family.members.map((member) => Number(member.chat.updatedAt ?? 0)));
  const hasCurrent = (family: ChatFamily<T>) => family.root.id === currentChatId || family.members.some((member) => member.chat.id === currentChatId);
  return families.sort((left, right) => Number(hasCurrent(right)) - Number(hasCurrent(left)) || latest(right) - latest(left));
}

/** 「못된라일리 (Branch 3)」 under the root 「못된라일리」 reads 「(Branch 3)」; unrelated titles stay whole. */
export function familyShortTitle(title: string, rootTitle: string): string {
  const rest = rootTitle && title.startsWith(rootTitle) ? title.slice(rootTitle.length).trim() : "";
  return rest || title;
}

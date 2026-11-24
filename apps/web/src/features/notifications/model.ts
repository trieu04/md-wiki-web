import type { components } from '@md-wiki/contracts';
import { formatRelative } from '@md-wiki/domain';

export type NotificationDto = components['schemas']['NotificationDto'];
export type NotificationListDto = components['schemas']['NotificationListDto'];

const EVENT_TITLE: Record<NotificationDto['event'], string> = {
  section_recheck: 'Under re-check',
  section_edited: 'Section edited',
  report_outcome: 'Your report',
  report_received: 'New report',
  mention: 'Mentioned',
  weekly_summary: 'Weekly summary',
};

/** Derived bell list (D-16, §7.7.13): one row per notification, newest first. */
export function notificationRow(item: NotificationDto, now: Date) {
  const page = item.path ? `/wiki/${item.path.split('/').map(encodeURIComponent).join('/')}` : null;
  const topicId =
    item.event === 'mention' && typeof item.data.topicId === 'string' ? item.data.topicId : null;
  return {
    key: item.id,
    id: item.id,
    kind: EVENT_TITLE[item.event],
    page: item.pageTitle,
    text: item.text,
    href: topicId
      ? `/work/discussions?topic=${encodeURIComponent(topicId)}`
      : page && item.anchor
        ? `${page}#${encodeURIComponent(item.anchor)}`
        : page,
    unread: item.readAt === null,
    at: item.createdAt,
    when: formatRelative(new Date(item.createdAt), now),
  };
}

export function unreadLabel(unread: number) {
  return unread ? `${String(unread)} unread` : 'All read';
}

import { Inject, Injectable } from '@nestjs/common';
import {
  buildDigest,
  deliveryFor,
  prefsFromRows,
  rowsFromPrefs,
  type NotificationEvent,
  type NotificationPrefs,
} from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { decodeCursor, encodeCursor } from '../contributions/pins.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail.js';
import type {
  NoticeDto,
  NotificationDto,
  NotificationListDto,
  NotificationListInput,
  NotificationPrefsDto,
} from './notifications.dto.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
export interface NotifyInput {
  userIds: readonly string[];
  event: NotificationEvent;
  path: string | null;
  anchor?: string | null;
  text: string;
  data?: Prisma.InputJsonObject;
}
const NOTICE_EVENTS: NotificationEvent[] = ['section_recheck', 'section_edited', 'report_outcome'];
const DAY_MS = 86_400_000;

/** In-app notifications, preferences and email digests (system-logic §7.7.9). */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async prefs(userId: string, db: Db = this.db): Promise<NotificationPrefs> {
    const rows = await db.notificationPref.findMany({ where: { userId } });
    return prefsFromRows(rows.map((r) => ({ event: r.event, channel: r.channel })));
  }

  async setPrefs(userId: string, prefs: NotificationPrefsDto): Promise<Wire<NotificationPrefsDto>> {
    await this.db.$transaction(async (tx) => {
      for (const row of rowsFromPrefs(prefs))
        await tx.notificationPref.upsert({
          where: { userId_event: { userId, event: row.event } },
          create: { userId, event: row.event, channel: row.channel },
          update: { channel: row.channel },
        });
    });
    return this.prefs(userId);
  }

  /**
   * Store notifications for the recipients whose preferences want them (inside the caller's
   * transaction). Agents and disabled users never get notifications. Returns the ids of the
   * recipients who should also get an immediate email (when `immediate`).
   */
  async notify(tx: Tx, input: NotifyInput): Promise<string[]> {
    const ids = [...new Set(input.userIds)];
    if (!ids.length) return [];
    const users = await tx.user.findMany({
      where: { id: { in: ids }, kind: 'human', disabledAt: null },
      select: { id: true },
    });
    const prefRows = await tx.notificationPref.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    const email: string[] = [];
    const data: Prisma.InputJsonObject = { ...(input.data ?? {}), text: input.text };
    for (const user of users) {
      const prefs = prefsFromRows(
        prefRows
          .filter((r) => r.userId === user.id)
          .map((r) => ({ event: r.event, channel: r.channel })),
      );
      const delivery = deliveryFor(input.event, prefs);
      if (!delivery.inApp) continue;
      await tx.notification.create({
        data: {
          userId: user.id,
          event: input.event,
          path: input.path,
          anchor: input.anchor ?? null,
          data,
        },
      });
      if (delivery.email) email.push(user.id);
    }
    return email;
  }

  /** Send one email now (blocking reports, §7.7.6); marks the newest matching notification. */
  async sendNow(userIds: readonly string[], subject: string, text: string) {
    if (!userIds.length) return;
    const users = await this.db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true },
    });
    for (const user of users) {
      await this.mail.send({ to: user.email, subject: `${this.config.WIKI_NAME}: ${subject}`, text });
      const latest = await this.db.notification.findFirst({
        where: { userId: user.id, emailedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (latest)
        await this.db.notification.update({ where: { id: latest.id }, data: { emailedAt: new Date() } });
    }
  }

  async followers(tx: Db, paths: readonly string[], except: readonly string[] = []) {
    if (!paths.length) return new Map<string, string[]>();
    const rows = await tx.follow.findMany({
      where: { path: { in: [...new Set(paths)] }, mutedAt: null, userId: { notIn: [...except] } },
      select: { userId: true, path: true },
    });
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.path, [...new Set([...(out.get(r.path) ?? []), r.userId])]);
    return out;
  }

  // ---- reads --------------------------------------------------------------------------------

  private async titles(paths: (string | null)[]) {
    const unique = [...new Set(paths.filter((p): p is string => p !== null))];
    if (!unique.length) return new Map<string, string>();
    const pages = await this.db.page.findMany({
      where: { path: { in: unique } },
      select: { path: true, title: true },
    });
    return new Map(pages.map((p) => [p.path, p.title]));
  }

  private dto(
    row: Prisma.NotificationGetPayload<object>,
    titles: Map<string, string>,
  ): Wire<NotificationDto> {
    const data = (row.data ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      event: row.event as NotificationEvent,
      path: row.path,
      pageTitle: row.path ? (titles.get(row.path) ?? null) : null,
      anchor: row.anchor,
      text: typeof data.text === 'string' ? data.text : '',
      data,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    };
  }

  async list(userId: string, input: NotificationListInput): Promise<Wire<NotificationListDto>> {
    const limit = input.limit ?? 25;
    const cursor = decodeCursor(input.cursor);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(input.unread === 'true' && { readAt: null }),
      ...(cursor && {
        OR: [
          { createdAt: { lt: cursor.at } },
          { createdAt: cursor.at, id: { lt: cursor.id } },
        ],
      }),
    };
    const [rows, unread] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.db.notification.count({ where: { userId, readAt: null } }),
    ]);
    const page = rows.slice(0, limit);
    const titles = await this.titles(page.map((r) => r.path));
    const last = page.at(-1);
    return {
      items: page.map((r) => this.dto(r, titles)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      unread,
    };
  }

  async markRead(userId: string, input: { ids?: string[]; all?: boolean }) {
    if (!input.all && !input.ids?.length)
      throw new AppError('VALIDATION_FAILED', 'Send ids or all', [
        { path: 'ids', code: 'REQUIRED', message: 'Send ids or all: true' },
      ]);
    await this.db.notification.updateMany({
      where: { userId, readAt: null, ...(input.all ? {} : { id: { in: input.ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    return { unread: await this.db.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Home › *On pages you use* (§7.7.9): the newest trust notices. */
  async notices(userId: string): Promise<{ items: Wire<NoticeDto>[] }> {
    const rows = await this.db.notification.findMany({
      where: { userId, event: { in: NOTICE_EVENTS }, path: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    });
    const titles = await this.titles(rows.map((r) => r.path));
    return {
      items: rows.map((r) => {
        const data = (r.data ?? {}) as Record<string, unknown>;
        const action: NoticeDto['action'] =
          r.event === 'section_edited'
            ? 'check_again'
            : r.event === 'report_outcome'
              ? 'see_outcome'
              : data.cause === 'retraction' || data.cause === 'propagated'
                ? 'see_affected'
                : 'read_section';
        return {
          id: r.id,
          event: r.event as NotificationEvent,
          path: r.path ?? '',
          pageTitle: titles.get(r.path ?? '') ?? r.path ?? '',
          anchor: r.anchor,
          text: typeof data.text === 'string' ? data.text : '',
          action,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  }

  // ---- digests ------------------------------------------------------------------------------

  /** Daily email digest (and the weekly summary on Mondays). Returns the number of emails sent. */
  async runDigests(now: Date): Promise<number> {
    const emailUsers = await this.db.notificationPref.findMany({
      where: { channel: 'email_daily' },
      select: { userId: true },
      distinct: ['userId'],
    });
    let sent = 0;
    for (const { userId } of emailUsers) {
      const user = await this.db.user.findUnique({ where: { id: userId } });
      if (!user || user.disabledAt || user.kind !== 'human') continue;
      const prefs = await this.prefs(userId);
      const weekly = now.getUTCDay() === 1 && prefs.events.weekly_summary;
      const since = new Date(now.getTime() - (weekly ? 7 : 1) * DAY_MS);
      const rows = await this.db.notification.findMany({
        where: weekly
          ? { userId, createdAt: { gte: since } }
          : { userId, emailedAt: null, createdAt: { lte: now } },
        orderBy: { createdAt: 'asc' },
      });
      const titles = await this.titles(rows.map((r) => r.path));
      const digest = buildDigest(
        { name: user.name },
        rows.map((r) => ({
          event: r.event as NotificationEvent,
          path: r.path,
          pageTitle: r.path ? (titles.get(r.path) ?? null) : null,
          text: typeof (r.data as Record<string, unknown>).text === 'string'
            ? String((r.data as Record<string, unknown>).text)
            : r.event,
          createdAt: r.createdAt.toISOString(),
        })),
        weekly ? 'weekly' : 'daily',
        this.config.WIKI_NAME,
      );
      if (!digest) continue;
      await this.mail.send({ to: user.email, subject: digest.subject, text: digest.text });
      await this.db.notification.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, emailedAt: null },
        data: { emailedAt: now },
      });
      sent++;
    }
    return sent;
  }
}

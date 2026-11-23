import type { components } from '@md-wiki/contracts';
import { visualSession } from './reading';

type UserDto = components['schemas']['UserDto'];
type TeamDto = components['schemas']['TeamDto'];
type ApiTokenDto = components['schemas']['ApiTokenDto'];

const createdAt = '2026-11-01T09:00:00Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** F-14 is owner-only; the visual build signs in m.nguyen as the owner (D-52). */
export const visualOwnerSession = {
  ...visualSession,
  user: { ...visualSession.user, roles: ['owner'] },
} satisfies components['schemas']['SessionDto'];

// F-14 People and teams: "Imaging core, Light-sheet, Cell biology, Image analysis, +5".
export const visualTeams: TeamDto[] = [
  'Imaging core',
  'Light-sheet',
  'Cell biology',
  'Image analysis',
  'Neurobiology',
  'Structural biology',
  'Developmental biology',
  'Flow cytometry',
  'Histology',
].map((name, index) => ({
  id: uuid(100 + index),
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
}));

const team = (index: number) => visualTeams[index]?.id ?? null;
const user = (
  n: number,
  name: string,
  email: string,
  roles: UserDto['roles'],
  teamId: string | null,
  kind: UserDto['kind'] = 'human',
  disabled = false,
): UserDto => ({ id: uuid(n), name, email, roles, teamId, kind, disabled, createdAt });

export const visualUsers: UserDto[] = [
  user(0, 'm.nguyen', 'mn@example.test', ['owner'], team(0)),
  user(1, 'h.pham', 'hp@example.test', ['reviewer'], team(0)),
  user(2, 'l.tran', 'lt@example.test', ['reader'], team(2)),
  user(3, 'a.perez', 'ap@example.test', ['contributor'], team(1), 'human', true),
  user(4, 'reviewer-agent', 'reviewer-agent@agents.invalid', ['reviewer'], null, 'agent'),
  user(5, 'lab-agent', 'lab-agent@agents.invalid', ['contributor'], null, 'agent'),
];

// F-14 Agents and tokens: the token name carries the frame's help text (D-50).
export const visualTokens: ApiTokenDto[] = [
  {
    id: uuid(200),
    userId: uuid(4),
    name: 'Decides proposals.',
    prefix: 'Rk3d9f2a',
    scopes: ['review', 'discuss'],
    createdAt,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  },
  {
    id: uuid(201),
    userId: uuid(5),
    name: 'Submits proposals through the API and MCP.',
    prefix: 'Qp7x41c0',
    scopes: ['contribute'],
    createdAt,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  },
];

export const adminPage = <T>(items: T[]) => ({ items, nextCursor: null });

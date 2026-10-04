import { z } from 'zod';

/** Avatar = coloured circle + emoji face. Both fields are indices into these lists. */
export const AVATAR_COLORS: readonly string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#78716c',
];

export const AVATAR_EMOJIS: readonly string[] = [
  '😀', '😎', '🤠', '🥳', '🤖', '👻', '🐱', '🐶', '🦊', '🐼', '🐸', '🐵',
  '🦄', '🐙', '🐧', '🦖', '🍕', '🌵', '🚀', '🎃', '🐝', '🦋', '🐢', '🦁',
];

export const avatarSchema = z.object({
  color: z.number().int().min(0).max(AVATAR_COLORS.length - 1),
  emoji: z.number().int().min(0).max(AVATAR_EMOJIS.length - 1),
});

export type Avatar = z.infer<typeof avatarSchema>;

export function randomAvatar(rand: () => number = Math.random): Avatar {
  return {
    color: Math.floor(rand() * AVATAR_COLORS.length),
    emoji: Math.floor(rand() * AVATAR_EMOJIS.length),
  };
}

export function avatarColor(a: Avatar): string {
  return AVATAR_COLORS[a.color] ?? AVATAR_COLORS[0];
}

export function avatarEmoji(a: Avatar): string {
  return AVATAR_EMOJIS[a.emoji] ?? AVATAR_EMOJIS[0];
}

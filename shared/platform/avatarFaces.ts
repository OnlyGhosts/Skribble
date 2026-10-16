/**
 * The avatar faces, drawn as Microsoft Fluent Emoji (the Color style Windows 11 shows) so every
 * device shows the same picture. A saved avatar keeps only the index, so the order never changes:
 * new faces go at the end. `name` is the Fluent asset's name (and the image's alt text); the
 * picture is client/public/avatars/<file>.webp, made by scripts/avatars.mjs. No imports, so that
 * script can load this file on its own.
 */
export interface AvatarFace {
  emoji: string;
  name: string;
  file: string;
}

function face(emoji: string, name: string): AvatarFace {
  return { emoji, name, file: name.toLowerCase().replace(/ /g, '-') };
}

export const AVATAR_FACES: readonly AvatarFace[] = [
  face('😀', 'Grinning face'),
  face('😎', 'Smiling face with sunglasses'),
  face('🤠', 'Cowboy hat face'),
  face('🥳', 'Partying face'),
  face('🤖', 'Robot'),
  face('👻', 'Ghost'),
  face('🐱', 'Cat face'),
  face('🐶', 'Dog face'),
  face('🦊', 'Fox'),
  face('🐼', 'Panda'),
  face('🐸', 'Frog'),
  face('🐵', 'Monkey face'),
  face('🦄', 'Unicorn'),
  face('🐙', 'Octopus'),
  face('🐧', 'Penguin'),
  face('🦖', 'T-rex'),
  face('🍕', 'Pizza'),
  face('🌵', 'Cactus'),
  face('🚀', 'Rocket'),
  face('🎃', 'Jack-o-lantern'),
  face('🐝', 'Honeybee'),
  face('🦋', 'Butterfly'),
  face('🐢', 'Turtle'),
  face('🦁', 'Lion'),
  face('🤪', 'Zany face'),
  face('😴', 'Sleeping face'),
  face('🤓', 'Nerd face'),
  face('🥸', 'Disguised face'),
  face('🤡', 'Clown face'),
  face('👽', 'Alien'),
  face('💀', 'Skull'),
  face('🐻', 'Bear'),
  face('🐨', 'Koala'),
  face('🐯', 'Tiger face'),
  face('🐷', 'Pig face'),
  face('🐮', 'Cow face'),
  face('🐰', 'Rabbit face'),
  face('🦉', 'Owl'),
  face('🦩', 'Flamingo'),
  face('🐳', 'Spouting whale'),
  face('🦈', 'Shark'),
  face('🦀', 'Crab'),
  face('🐲', 'Dragon face'),
  face('🦥', 'Sloth'),
  face('🦔', 'Hedgehog'),
  face('🍔', 'Hamburger'),
  face('🌮', 'Taco'),
  face('🍩', 'Doughnut'),
  face('🍉', 'Watermelon'),
  face('🥑', 'Avocado'),
];

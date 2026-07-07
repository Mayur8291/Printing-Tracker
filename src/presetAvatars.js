export const PRESET_AVATAR_PREFIX = "preset:";

/** Built-in profile avatars served from /public/avatars/presets */
export const PRESET_AVATARS = [
  { id: "avatar-02", label: "Avatar 1", url: "/avatars/presets/avatar-02.png" },
  { id: "avatar-03", label: "Avatar 2", url: "/avatars/presets/avatar-03.png" },
  { id: "avatar-04", label: "Avatar 3", url: "/avatars/presets/avatar-04.png" },
  { id: "avatar-05", label: "Avatar 4", url: "/avatars/presets/avatar-05.png" },
  { id: "avatar-06", label: "Avatar 5", url: "/avatars/presets/avatar-06.png" },
  { id: "avatar-07", label: "Avatar 6", url: "/avatars/presets/avatar-07.png" },
  { id: "avatar-08", label: "Avatar 7", url: "/avatars/presets/avatar-08.png" },
  { id: "avatar-09", label: "Avatar 8", url: "/avatars/presets/avatar-09.png" },
  { id: "avatar-10", label: "Avatar 9", url: "/avatars/presets/avatar-10.png" },
  { id: "avatar-11", label: "Avatar 10", url: "/avatars/presets/avatar-11.png" },
  { id: "avatar-12", label: "Avatar 11", url: "/avatars/presets/avatar-12.png" },
  { id: "avatar-13", label: "Avatar 12", url: "/avatars/presets/avatar-13.png" },
  { id: "avatar-14", label: "Avatar 13", url: "/avatars/presets/avatar-14.png" },
  { id: "avatar-15", label: "Avatar 14", url: "/avatars/presets/avatar-15.png" },
  { id: "avatar-16", label: "Avatar 15", url: "/avatars/presets/avatar-16.png" },
  { id: "avatar-17", label: "Avatar 16", url: "/avatars/presets/avatar-17.png" },
  { id: "avatar-18", label: "Avatar 17", url: "/avatars/presets/avatar-18.png" },
  { id: "avatar-19", label: "Avatar 18", url: "/avatars/presets/avatar-19.png" },
  { id: "avatar-20", label: "Avatar 19", url: "/avatars/presets/avatar-20.png" },
  { id: "avatar-21", label: "Avatar 20", url: "/avatars/presets/avatar-21.png" },
  { id: "avatar-22", label: "Avatar 21", url: "/avatars/presets/avatar-22.png" },
  { id: "avatar-23", label: "Avatar 22", url: "/avatars/presets/avatar-23.png" },
  { id: "avatar-24", label: "Avatar 23", url: "/avatars/presets/avatar-24.png" },
  { id: "avatar-25", label: "Avatar 24", url: "/avatars/presets/avatar-25.png" },
  { id: "avatar-26", label: "Avatar 25", url: "/avatars/presets/avatar-26.png" },
  { id: "avatar-27", label: "Avatar 26", url: "/avatars/presets/avatar-27.png" },
  { id: "avatar-28", label: "Avatar 27", url: "/avatars/presets/avatar-28.png" },
  { id: "avatar-29", label: "Avatar 28", url: "/avatars/presets/avatar-29.png" },
  { id: "avatar-30", label: "Avatar 29", url: "/avatars/presets/avatar-30.png" },
  { id: "avatar-31", label: "Avatar 30", url: "/avatars/presets/avatar-31.png" },
  { id: "avatar-32", label: "Avatar 31", url: "/avatars/presets/avatar-32.png" },
  { id: "avatar-33", label: "Avatar 32", url: "/avatars/presets/avatar-33.png" },
  { id: "avatar-34", label: "Avatar 33", url: "/avatars/presets/avatar-34.png" },
  { id: "avatar-35", label: "Avatar 34", url: "/avatars/presets/avatar-35.png" },
  { id: "avatar-36", label: "Avatar 35", url: "/avatars/presets/avatar-36.png" },
  { id: "avatar-37", label: "Avatar 36", url: "/avatars/presets/avatar-37.png" },
  { id: "avatar-38", label: "Avatar 37", url: "/avatars/presets/avatar-38.png" },
  { id: "avatar-39", label: "Avatar 38", url: "/avatars/presets/avatar-39.png" },
  { id: "avatar-40", label: "Avatar 39", url: "/avatars/presets/avatar-40.png" },
  { id: "avatar-41", label: "Avatar 40", url: "/avatars/presets/avatar-41.png" },
  { id: "avatar-42", label: "Avatar 41", url: "/avatars/presets/avatar-42.png" },
  { id: "avatar-43", label: "Avatar 42", url: "/avatars/presets/avatar-43.png" },
  { id: "avatar-44", label: "Avatar 43", url: "/avatars/presets/avatar-44.png" },
  { id: "avatar-45", label: "Avatar 44", url: "/avatars/presets/avatar-45.png" },
  { id: "avatar-46", label: "Avatar 45", url: "/avatars/presets/avatar-46.png" },
  { id: "avatar-47", label: "Avatar 46", url: "/avatars/presets/avatar-47.png" },
  { id: "avatar-48", label: "Avatar 47", url: "/avatars/presets/avatar-48.png" },
  { id: "avatar-49", label: "Avatar 48", url: "/avatars/presets/avatar-49.png" },
  { id: "avatar-50", label: "Avatar 49", url: "/avatars/presets/avatar-50.png" },
  { id: "avatar-51", label: "Avatar 50", url: "/avatars/presets/avatar-51.png" }
];

export const PRESET_AVATAR_BY_ID = Object.fromEntries(PRESET_AVATARS.map((a) => [a.id, a]));

export function isPresetAvatarPath(avatarPath) {
  return Boolean(avatarPath?.trim().startsWith(PRESET_AVATAR_PREFIX));
}

export function parsePresetAvatarId(avatarPath) {
  if (!isPresetAvatarPath(avatarPath)) return null;
  const id = avatarPath.trim().slice(PRESET_AVATAR_PREFIX.length);
  return PRESET_AVATAR_BY_ID[id] ? id : null;
}

export function presetAvatarPublicUrl(presetId) {
  return PRESET_AVATAR_BY_ID[presetId]?.url ?? "";
}

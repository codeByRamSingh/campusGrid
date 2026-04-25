export type SavedPreset<TValues extends Record<string, string | number | boolean>> = {
  id: string;
  name: string;
  values: TValues;
  createdAt: string;
  updatedAt: string;
};

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function loadSavedPresets<TValues extends Record<string, string | number | boolean>>(storageKey: string): Array<SavedPreset<TValues>> {
  if (typeof window === "undefined") {
    return [];
  }

  return safeParse<Array<SavedPreset<TValues>>>(window.localStorage.getItem(storageKey), []);
}

export function writeSavedPresets<TValues extends Record<string, string | number | boolean>>(
  storageKey: string,
  presets: Array<SavedPreset<TValues>>
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(presets));
}

export function upsertSavedPreset<TValues extends Record<string, string | number | boolean>>(
  storageKey: string,
  name: string,
  values: TValues,
  maxPresets = 20
): Array<SavedPreset<TValues>> {
  const now = new Date().toISOString();
  const existing = loadSavedPresets<TValues>(storageKey);
  const normalizedName = name.trim();
  const index = existing.findIndex((preset) => preset.name.toLowerCase() === normalizedName.toLowerCase());

  if (index >= 0) {
    existing[index] = {
      ...existing[index],
      values,
      updatedAt: now,
    };
  } else {
    existing.unshift({
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      values,
      createdAt: now,
      updatedAt: now,
    });
  }

  const trimmed = existing.slice(0, maxPresets);
  writeSavedPresets(storageKey, trimmed);
  return trimmed;
}

export function removeSavedPreset<TValues extends Record<string, string | number | boolean>>(
  storageKey: string,
  presetId: string
): Array<SavedPreset<TValues>> {
  const existing = loadSavedPresets<TValues>(storageKey);
  const next = existing.filter((preset) => preset.id !== presetId);
  writeSavedPresets(storageKey, next);
  return next;
}

function escapeCsvCell(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function exportRowsToCsv(fileName: string, headers: string[], rows: string[][]) {
  if (typeof window === "undefined") {
    return;
  }

  const csv = [
    headers.map((header) => escapeCsvCell(header)).join(","),
    ...rows.map((row) => row.map((cell) => escapeCsvCell(cell ?? "")).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

import { api } from "./api";

export type AppSettings = {
  trust?: { id: string; name: string; address?: string; registrationNumber?: string } | null;
  security: { staffDefaultPasswordPolicy: string; authStandard: string };
  localization: { timezone: string; currency: string; dateFormat: string };
};

export type LocalizationSettings = {
  localization: { timezone: string; currency: string; dateFormat: string };
  updatedAt: string;
};

export const settingsApi = {
  getSettings: () =>
    api.get<AppSettings>("/settings").then((r) => r.data),

  updateSettings: (data: {
    localization?: { timezone?: string; currency?: string; dateFormat?: string };
    security?: { authStandard?: string; staffDefaultPasswordPolicy?: string };
  }) => api.patch<AppSettings>("/settings", data).then((r) => r.data),

  updateCollegeSettings: (data: {
    localization?: { timezone?: string; currency?: string; dateFormat?: string };
  }) => api.patch<LocalizationSettings>("/settings/college", data).then((r) => r.data),
};

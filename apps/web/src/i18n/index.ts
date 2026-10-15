import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zh from "./locales/zh";

export const LANGUAGE_STORAGE_KEY = "om.language";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

function detectInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(language: SupportedLanguage): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  void i18n.changeLanguage(language);
}

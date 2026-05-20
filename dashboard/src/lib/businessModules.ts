export type BusinessModules = {
  selfStudyLibrary: boolean;
  coaching: boolean;
  school: boolean;
  books: boolean;
  lockers: boolean;
  billing: boolean;
  accounting: boolean;
  purchases: boolean;
  reports: boolean;
  staff: boolean;
  users: boolean;
};

export const DEFAULT_BUSINESS_MODULES: BusinessModules = {
  selfStudyLibrary: true,
  coaching: true,
  school: false,
  books: true,
  lockers: true,
  billing: true,
  accounting: true,
  purchases: true,
  reports: true,
  staff: true,
  users: true,
};

export function normalizeBusinessModules(raw: unknown): BusinessModules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_BUSINESS_MODULES;
  return { ...DEFAULT_BUSINESS_MODULES, ...(raw as Partial<BusinessModules>) };
}

export function moduleLabels(modules: BusinessModules) {
  const labels: string[] = [];
  if (modules.selfStudyLibrary) labels.push("Self-study library");
  if (modules.coaching) labels.push("Coaching");
  if (modules.school) labels.push("School");
  if (!labels.length) labels.push("General institute");
  return labels;
}

// The shared words that items and app profiles use to find each other.
// Levels follow the whitepaper: S1 public, S2 everyday, S3 private, S4 documents.
export const KINDS = {
  identity: { zh: "身份", en: "Identity" },
  preference: { zh: "偏好", en: "Preferences" },
  work: { zh: "项目和技能", en: "Work and skills" },
  now: { zh: "近况和打算", en: "Now and next" },
  people: { zh: "人", en: "People" },
  constraint: { zh: "规矩和底线", en: "Rules and limits" },
};

export const TAGS = {
  name: "S2", languages: "S1", home_city: "S2", home_address: "S3", timezone: "S1", birthday: "S3", age: "S3",
  email: "S2", phone: "S3", passport: "S4", id_document: "S4", nationality: "S3", visa_status: "S4",
  occupation: "S1", employer: "S2", income: "S4", education: "S2", career_goal: "S3",
  diet: "S2", allergy: "S3", food_taste: "S2", cooking: "S2",
  travel_style: "S2", lodging_pref: "S2", upcoming_trip: "S2", transport: "S2",
  budget: "S2", shopping: "S2", brands: "S2", devices: "S2", sizes: "S3",
  schedule: "S2", communication: "S2", tone: "S1",
  partner: "S3", family: "S3", kids: "S3", pets: "S2", friends: "S3", colleagues: "S3",
  health: "S4", fitness: "S2", sleep: "S3", mental_health: "S4",
  housing: "S3", vehicle: "S2", finance: "S4",
  tech_stack: "S1", coding_style: "S1", tools: "S1", projects: "S2", learning: "S2",
  interests: "S1", media: "S1", values: "S2", writing_style: "S1",
  // Mostly for forms (visas, rentals, jobs). Documents stay S4: only what the person adds by hand fills them.
  travel_history: "S2", social_accounts: "S2", work_history: "S2", skills: "S1",
  gender: "S3", marital_status: "S3", emergency_contact: "S3", insurance: "S4", photo: "S4",
};

export const LEVEL_RANK = { S1: 1, S2: 2, S3: 3, S4: 4 };
export const LEVELS = {
  S1: { zh: "S1 公开", en: "S1 public" }, S2: { zh: "S2 日常", en: "S2 everyday" },
  S3: { zh: "S3 私密", en: "S3 private" }, S4: { zh: "S4 证件", en: "S4 documents" },
};

// The first tag says what the item is about, so it sets the level.
// Side tags don't raise it: "两只猫，花销不小" tagged pets + finance is a pet fact, not money data.
export function defaultLevel(tags) {
  return TAGS[(tags || [])[0]] || "S2";
}

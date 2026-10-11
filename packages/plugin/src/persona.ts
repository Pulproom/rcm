type Persona = { id?: unknown; name?: unknown };

const normalizedName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();

export function resolveUserPersonaName(
  database: { personas?: unknown; selectedPersona?: unknown } | undefined,
  chat: { bindedPersona?: unknown } | undefined,
): string | undefined {
  const personas = Array.isArray(database?.personas) ? database.personas as Persona[] : [];
  const boundPersona = typeof chat?.bindedPersona === "string"
    ? personas.find((persona) => persona?.id === chat.bindedPersona)
    : undefined;
  const selectedPersona = typeof database?.selectedPersona === "number"
    ? personas[database.selectedPersona]
    : personas.find((persona) => persona?.id === database?.selectedPersona);
  return String(boundPersona?.name ?? selectedPersona?.name ?? "").trim() || undefined;
}

export function matchPersonaEntity(
  personaName: string | undefined,
  entities: Array<{ name: string; aliases?: string[] }>,
  override: string | null,
): string | null {
  if (override !== null) return override;
  const target = normalizedName(personaName);
  if (!target) return null;
  return entities.find((entity) => [entity.name, ...(entity.aliases ?? [])]
    .some((name) => normalizedName(name) === target))?.name ?? null;
}

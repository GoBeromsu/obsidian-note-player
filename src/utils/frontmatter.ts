export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asTrimmedString(entry))
      .filter((entry): entry is string => entry !== null);
  }

  const single = asTrimmedString(value);
  return single ? [single] : [];
}

export function hasType(frontmatter: Record<string, unknown> | undefined, expected: string): boolean {
  if (!frontmatter) {
    return false;
  }

  return asStringArray(frontmatter.type).some(
    (value) => value.toLowerCase() === expected.toLowerCase(),
  );
}

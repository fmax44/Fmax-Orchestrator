export function markdownList(items: string[] | undefined, fallback = "Not specified."): string {
  if (!items?.length) {
    return fallback;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function checklist(items: string[] | undefined, fallback = "- [ ] Not specified"): string {
  if (!items?.length) {
    return fallback;
  }

  return items.map((item) => `- [ ] ${item}`).join("\n");
}

export function replaceMarkdownSection(markdown: string, heading: string, value: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(## ${escapedHeading}\\s*\\n\\s*)([\\s\\S]*?)(?=\\n## |$)`);

  if (!pattern.test(markdown)) {
    throw new Error(`Markdown section not found: ${heading}`);
  }

  return markdown.replace(pattern, `$1${value.trim()}\n`);
}

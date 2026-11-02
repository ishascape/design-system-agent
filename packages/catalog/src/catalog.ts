/**
 * Builds the agent-readable catalog and checks that every layer agrees.
 *
 * Inputs: the token manifest, component specs, the components' TypeScript and CSS, and the
 * Figma id map. Outputs:
 * - catalog.json: everything an AI agent needs in one typed file
 * - components/<id>.md: one readable page per component (for people and agents)
 * - llms.txt: the index agents look for first
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentSpec } from '@dsa/registry';
import { extractProps, type PropDoc } from './props.ts';

export interface ManifestToken {
  name: string;
  cssVar: string;
  type: string;
  css: string;
  description?: string;
}

export interface CatalogComponent {
  spec: ComponentSpec;
  props: PropDoc[];
  usage: string;
}

export interface Catalog {
  schemaVersion: 1;
  name: string;
  tokens: ManifestToken[];
  components: CatalogComponent[];
}

/** Problems found when comparing layers. Empty means everything agrees. */
export function checkComponent(
  root: string,
  spec: ComponentSpec,
  tokens: ManifestToken[],
  variantsInCode: readonly string[],
): string[] {
  const problems: string[] = [];
  const byName = new Map(tokens.map((t) => [t.name, t]));
  for (const t of spec.tokens)
    if (!byName.has(t.name)) problems.push(`${spec.id}: spec token "${t.name}" is not in the token manifest`);

  const css = readFileSync(join(root, spec.code.css), 'utf8');
  const usedVars = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]!));
  const specVars = new Set(spec.tokens.flatMap((t) => byName.get(t.name)?.cssVar ?? []));
  for (const v of usedVars)
    if (!specVars.has(v)) problems.push(`${spec.id}: ${spec.code.css} uses ${v}, which the spec does not list`);
  for (const v of specVars)
    if (!usedVars.has(v)) problems.push(`${spec.id}: spec lists ${v}, which ${spec.code.css} does not use`);
  for (const v of usedVars)
    if (![...byName.values()].some((t) => t.cssVar === v)) problems.push(`${spec.id}: ${v} is not a canonical token`);

  const specVariants = spec.variants.map((v) => v.name).sort();
  const codeVariants = [...variantsInCode].sort();
  if (JSON.stringify(specVariants) !== JSON.stringify(codeVariants)) {
    problems.push(`${spec.id}: spec variants [${specVariants}] differ from code [${codeVariants}]`);
  }
  if (!css.includes(`.${spec.code.className}`))
    problems.push(`${spec.id}: class .${spec.code.className} not found in ${spec.code.css}`);
  return problems;
}

function usageExample(spec: ComponentSpec): string {
  return spec.code.examples.join('\n');
}

export function buildCatalog(root: string, name: string, tokens: ManifestToken[], specs: ComponentSpec[]): Catalog {
  return {
    schemaVersion: 1,
    name,
    tokens,
    components: specs.map((spec) => ({
      spec,
      props: extractProps(join(root, spec.code.file), spec.code.propsTypes),
      usage: usageExample(spec),
    })),
  };
}

const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

export function renderComponentMarkdown(c: CatalogComponent, tokens: ManifestToken[]): string {
  const { spec, props } = c;
  const byName = new Map(tokens.map((t) => [t.name, t]));
  const typeNames = spec.code.propsTypes;
  const propRows = props.map((p) => {
    const types = typeNames
      .filter((t) => p.byType[t])
      .map(
        (t) =>
          `${t.replace(/Props$/, '')}: \`${p.byType[t]!.type.replace(/\|/g, '\\|')}\`${p.byType[t]!.required ? ' (required)' : ''}`,
      )
      .join('<br>');
    return `| \`${p.name}\` | ${types} | ${p.description.replace(/\|/g, '\\|')} |`;
  });
  return `# ${spec.name}

> ${spec.summary}

Status: **${spec.status}** · Version ${spec.version} · Source: ${spec.source.id} @ \`${spec.source.commit.slice(0, 7)}\`

## Use it

\`\`\`tsx
${c.usage}
\`\`\`

When to use:
${list(spec.whenToUse)}

When not to use:
${list(spec.whenNotToUse)}

## Props

Generated from \`${spec.code.file}\`. All other native \`<button>\` or \`<a>\` attributes (\`onClick\`, \`aria-*\`, \`target\`, ...) are passed through.

| Prop | Type | Description |
| --- | --- | --- |
${propRows.join('\n')}

## Variants

| Variant | Description | Confidence |
| --- | --- | --- |
${spec.variants.map((v) => `| \`${v.name}\` | ${v.description} | ${v.confidence} |`).join('\n')}

## States

| State | Trigger | Looks like | Confidence |
| --- | --- | --- | --- |
${spec.states.map((s) => `| ${s.name} | ${s.trigger} | ${s.visual} | ${s.confidence} |`).join('\n')}

## Anatomy

${spec.anatomy.map((a) => `- **${a.part}**${a.optional ? ' (optional)' : ''}: ${a.description}`).join('\n')}

## Tokens

| Token | CSS variable | Value | Used for |
| --- | --- | --- | --- |
${spec.tokens.map((t) => `| \`${t.name}\` | \`${byName.get(t.name)?.cssVar ?? '?'}\` | \`${byName.get(t.name)?.css ?? '?'}\` | ${t.usedFor} |`).join('\n')}

Fixed values (deliberately not tokens):
${list(spec.constants.map((k) => `${k.name}: \`${k.value}\`. ${k.reason}`))}

## Accessibility

Renders: ${spec.accessibility.elements.join('; ')}.

Keyboard:
${list(spec.accessibility.keyboard)}

${list(spec.accessibility.notes)}

## Guidelines

Do:
${list(spec.guidelines.do)}

Don't:
${list(spec.guidelines.dont)}

## Responsive

${list(spec.responsive)}

## Links

- Code: \`${spec.code.file}\`, styles \`${spec.code.css}\`
- Spec: \`registry/components/${spec.id}.json\`
${spec.figma ? `- Figma: node \`${spec.figma.node}\` in file \`${spec.figma.file}\` (${spec.figma.status}); ids in \`registry/figma-map.json\`` : '- Figma: not generated'}
${spec.docs ? `- Storybook: \`${spec.docs.storybook}\`` : ''}
- Source evidence: ${spec.source.styles.map((s) => `\`${s}\``).join(', ')}

## Open questions

${spec.openQuestions.length ? list(spec.openQuestions) : 'None.'}
`;
}

export function renderLlmsTxt(cat: Catalog): string {
  return `# ${cat.name} design system

> Tokens and React components extracted from ${cat.name}, with provenance. Use these instead of
> writing raw colours, sizes or new button styles.

Rules for agents:
- Use the components in \`@dsa/ui\` before writing new UI. Import \`@dsa/ui/styles.css\` once.
- Style only with the CSS variables listed in the token catalog; never hard-code colours or spacing.
- Specs marked pending-approval or states marked proposed are not final design decisions.

## Components

${cat.components.map((c) => `- [${c.spec.name}](docs/agents/components/${c.spec.id}.md): ${c.spec.summary}`).join('\n')}

## Tokens

- [Token manifest](packages/tokens/dist/tokens.manifest.json): every token with CSS variable, value and source line
- [Token CSS](packages/tokens/dist/tokens.css)

## Machine-readable

- [catalog.json](docs/agents/catalog.json): tokens, component specs and extracted props in one file
- [Component spec schema](packages/registry/src/component.ts)
`;
}

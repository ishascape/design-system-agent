import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentSpec } from '@dsa/registry';
import { BUTTON_VARIANTS } from '../../ui/src/button/variants.ts';
import { checkComponent, type ManifestToken } from './catalog.ts';
import { extractProps } from './props.ts';

const root = process.cwd();
const tokens = JSON.parse(
  readFileSync(join(root, 'packages/tokens/dist/tokens.manifest.json'), 'utf8'),
) as ManifestToken[];
const spec = ComponentSpec.parse(JSON.parse(readFileSync(join(root, 'registry/components/button.json'), 'utf8')));

describe('Button: spec, code, CSS and tokens agree', () => {
  it('passes the consistency check', () => {
    expect(checkComponent(root, spec, tokens, BUTTON_VARIANTS)).toEqual([]);
  });

  it('detects a token the spec lists but the CSS does not use, and a variant mismatch', () => {
    const broken = { ...spec, tokens: [...spec.tokens, { name: 'color.rule', usedFor: 'nothing' }] };
    expect(checkComponent(root, broken, tokens, ['outline'])).toEqual([
      'button: spec lists --color-rule, which packages/ui/src/button/button.css does not use',
      'button: spec variants [outline,primary] differ from code [outline]',
    ]);
  });

  it('extracts the documented props from TypeScript', () => {
    const props = extractProps(join(root, spec.code.file), spec.code.propsTypes);
    expect(props.map((p) => p.name)).toEqual(['variant', 'children', 'icon', 'href', 'disabled']);
    expect(props.every((p) => p.description.length > 0)).toBe(true);
  });
});

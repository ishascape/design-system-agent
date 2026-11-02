/**
 * The Figma plugin, run against a small stand-in for Figma's Plugin API. The same script was run in
 * a real Figma file through the Figma MCP (see packages/gen-figma/src/fixtures); this test covers
 * the plugin wrapper: messages in and out, and that code.js is the generated, current version.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VariablesReadback, checkVariablesReadback, type VariablesPayload } from '@dsa/gen-figma';
import { renderPluginCode } from '../figma-plugin/build.ts';

const code = readFileSync(new URL('../figma-plugin/code.js', import.meta.url), 'utf8');
const payload = JSON.parse(
  readFileSync(new URL('../../../packages/gen-figma/src/fixtures/variables-payload.json', import.meta.url), 'utf8'),
) as VariablesPayload;

interface FakeVar {
  id: string;
  name: string;
  resolvedType: string;
  variableCollectionId: string;
  description: string;
  scopes: string[];
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, unknown>;
  setVariableCodeSyntax(p: string, v: string): void;
  setValueForMode(m: string, v: unknown): void;
}

function fakeFigma(preexisting: { name: string; type: string }[] = []) {
  const collections: {
    id: string;
    name: string;
    modes: { modeId: string; name: string }[];
    renameMode: (id: string, n: string) => void;
  }[] = [];
  const vars: FakeVar[] = [];
  const posted: unknown[] = [];
  let n = 0;
  const mkCollection = (name: string) => {
    const c = {
      id: `VariableCollectionId:${++n}`,
      name,
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      renameMode(id: string, name: string) {
        c.modes.find((m) => m.modeId === id)!.name = name;
      },
    };
    collections.push(c);
    return c;
  };
  const mkVar = (name: string, c: { id: string }, type: string): FakeVar => {
    const v: FakeVar = {
      id: `VariableID:${++n}`,
      name,
      resolvedType: type,
      variableCollectionId: c.id,
      description: '',
      scopes: ['ALL_SCOPES'],
      codeSyntax: {},
      valuesByMode: {},
      setVariableCodeSyntax(p, val) {
        v.codeSyntax[p] = val;
      },
      setValueForMode(m, val) {
        v.valuesByMode[m] = val;
      },
    };
    vars.push(v);
    return v;
  };
  if (preexisting.length) {
    const c = mkCollection(payload.collectionName);
    for (const p of preexisting) mkVar(p.name, c, p.type);
  }
  const figma = {
    root: { name: 'Scratch file' },
    showUI: () => undefined,
    closePlugin: () => undefined,
    ui: {
      onmessage: undefined as undefined | ((m: unknown) => Promise<void>),
      postMessage: (m: unknown) => posted.push(m),
    },
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => vars,
      createVariableCollection: mkCollection,
      createVariable: mkVar,
    },
  };
  new Function('figma', '__html__', code)(figma, '<html></html>');
  return { figma, posted, vars };
}

describe('Figma plugin', () => {
  it('is the current generated version of the shared script', () => {
    expect(code).toBe(renderPluginCode());
  });

  it('applies a payload and returns a read-back the Studio accepts', async () => {
    const { figma, posted, vars } = fakeFigma();
    await figma.ui.onmessage!({ type: 'apply', payload });
    const msg = posted[0] as { type: string; result: unknown };
    expect(msg.type).toBe('done');
    const rb = VariablesReadback.parse(msg.result);
    expect(rb).toMatchObject({ fileName: 'Scratch file', created: payload.variables.length, updated: 0 });
    expect(checkVariablesReadback(payload, rb)).toEqual([]);
    expect(vars).toHaveLength(payload.variables.length);

    // Running it again updates in place: no duplicates.
    await figma.ui.onmessage!({ type: 'apply', payload });
    expect((posted[1] as { result: { created: number; updated: number } }).result).toMatchObject({
      created: 0,
      updated: payload.variables.length,
    });
    expect(vars).toHaveLength(payload.variables.length);
  });

  it('refuses a type conflict without changing anything, and rejects pasted text that is not a payload', async () => {
    const { figma, posted, vars } = fakeFigma([{ name: 'space/1', type: 'STRING' }]);
    await figma.ui.onmessage!({ type: 'apply', payload });
    expect(posted[0]).toEqual({
      type: 'error',
      message: 'Not changed, fix these by hand first (nothing was deleted): space/1 exists as STRING, expected FLOAT',
    });
    expect(vars.map((v) => v.name)).toContain('space/1');
    await figma.ui.onmessage!({ type: 'apply', payload: { hello: 'world' } });
    expect((posted[1] as { message: string }).message).toMatch(/not a Design System Studio Figma payload/);
  });
});

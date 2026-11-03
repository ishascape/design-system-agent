/* global figma, PAYLOAD */
/**
 * Runs inside Figma (the Studio's Figma plugin, or the Figma MCP `use_figma` tool).
 * `PAYLOAD` holds the project's variables, built by @dsa/gen-figma from approved tokens.
 *
 * Idempotent: the collection and each variable are found by name and updated in place. Nothing is
 * deleted. A variable that exists with a different type is reported, never replaced.
 * Returns a read-back of the whole collection so the Studio can check it against the tokens.
 */
if (!PAYLOAD || PAYLOAD.kind !== 'dsa-figma-variables' || PAYLOAD.version !== 1) {
  throw new Error('This is not a Design System Studio Figma payload. Copy it again from the Studio.');
}

const hexToColor = (h) => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
  a: h.length === 9 ? parseInt(h.slice(7, 9), 16) / 255 : 1,
});
const hex2 = (n) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, '0');
const colorToHex = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a !== undefined && c.a < 1 ? hex2(c.a) : ''}`;

const collections = await figma.variables.getLocalVariableCollectionsAsync();
let collection = collections.find((c) => c.name === PAYLOAD.collectionName);
if (!collection) collection = figma.variables.createVariableCollection(PAYLOAD.collectionName);
const modeId = collection.modes[0].modeId;
if (collection.modes[0].name !== 'Value') collection.renameMode(modeId, 'Value');

const existing = (await figma.variables.getLocalVariablesAsync()).filter(
  (v) => v.variableCollectionId === collection.id,
);
const conflicts = [];
let created = 0;
let updated = 0;
for (const t of PAYLOAD.variables) {
  let v = existing.find((x) => x.name === t.figmaName);
  if (v && v.resolvedType !== t.figmaType) {
    conflicts.push(`${t.figmaName} exists as ${v.resolvedType}, expected ${t.figmaType}`);
    continue;
  }
  if (v) updated++;
  else {
    v = figma.variables.createVariable(t.figmaName, collection, t.figmaType);
    created++;
  }
  v.description = t.description;
  v.scopes = t.scopes;
  v.setVariableCodeSyntax('WEB', `var(${t.cssVar})`);
  v.setValueForMode(modeId, t.figmaType === 'COLOR' ? hexToColor(t.value) : t.value);
}
if (conflicts.length) {
  throw new Error(`Not changed, fix these by hand first (nothing was deleted): ${conflicts.join('; ')}`);
}

const after = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === collection.id);
return {
  kind: 'dsa-figma-variables-readback',
  fileName: figma.root.name,
  collection: { id: collection.id, name: collection.name, modes: collection.modes.length },
  variables: after.map((v) => {
    const raw = v.valuesByMode[modeId];
    const value =
      raw && typeof raw === 'object' && 'r' in raw
        ? colorToHex(raw)
        : typeof raw === 'number' || typeof raw === 'string'
          ? raw
          : null;
    return {
      id: v.id,
      name: v.name,
      type: v.resolvedType,
      value,
      scopes: v.scopes,
      web: v.codeSyntax.WEB ?? null,
    };
  }),
  created,
  updated,
};

/**
 * Extracts a component's own props from its TypeScript source with the type checker, so the
 * documented API can never drift from the real one. Props inherited from React's DOM types
 * (onClick, aria-*, etc.) are summarised by the caller rather than listed.
 */
import ts from 'typescript';

export interface PropDoc {
  name: string;
  description: string;
  /** Per props type, how the prop is typed, e.g. href is `string` for links and `undefined` for buttons. */
  byType: Record<string, { type: string; required: boolean }>;
}

function declaredTypeText(sym: ts.Symbol, sf: ts.SourceFile): string | undefined {
  const d = sym.declarations?.find((x) => x.getSourceFile() === sf);
  return d && ts.isPropertySignature(d) && d.type ? d.type.getText(sf) : undefined;
}

export function extractProps(file: string, typeNames: string[]): PropDoc[] {
  const program = ts.createProgram([file], {
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    exactOptionalPropertyTypes: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    // Only what a component file needs; loading every @types package makes this very slow.
    types: [],
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`Cannot read ${file}`);

  const props = new Map<string, PropDoc>();
  for (const typeName of typeNames) {
    const decl = sf.statements.find(
      (s): s is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
        (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === typeName,
    );
    if (!decl) throw new Error(`Type ${typeName} not found in ${file}`);
    const type = checker.getTypeAtLocation(decl.name);
    for (const sym of checker.getPropertiesOfType(type)) {
      if (!sym.declarations?.some((d) => d.getSourceFile() === sf)) continue; // inherited DOM attribute
      // Prefer the resolved type when it is short (e.g. "outline" | "primary" instead of ButtonVariant);
      // fall back to the declared text for long library types such as ReactNode.
      const resolved = checker.typeToString(
        checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(sym, decl)),
        undefined,
        ts.TypeFormatFlags.NoTruncation,
      );
      const declared = declaredTypeText(sym, sf);
      const typeText = !declared || (resolved.length <= 60 && resolved !== 'never') ? resolved : declared;
      const description = ts.displayPartsToString(sym.getDocumentationComment(checker)).replace(/\s+/g, ' ').trim();
      const entry = props.get(sym.name) ?? { name: sym.name, description: '', byType: {} };
      if (!entry.description && description) entry.description = description;
      entry.byType[typeName] = { type: typeText, required: !(sym.flags & ts.SymbolFlags.Optional) };
      props.set(sym.name, entry);
    }
  }
  return [...props.values()];
}

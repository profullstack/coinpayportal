import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { join } from 'node:path';

describe('TypeScript declarations', () => {
  it('exposes the invoice API from the package entry point', () => {
    const fixture = join(import.meta.dirname, 'fixtures', 'invoice-types.ts');
    const program = ts.createProgram([fixture], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
    });

    const diagnostics = ts.getPreEmitDiagnostics(program);
    const messages = diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    );

    expect(messages).toEqual([]);
  });
});

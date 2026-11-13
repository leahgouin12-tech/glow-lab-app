/**
 * The one Node module the test suite reaches for, declared instead of pulling in
 * @types/node. Adding the full Node type package to a browser app's program
 * would make `process`, `Buffer` and `require` ambient in the shipped source,
 * which is exactly the mistake this project cannot afford to type-check silently.
 *
 * The shape below is the part sha256.test.ts actually calls. If Node ever
 * disagreed, the parity test fails at runtime — this declaration cannot make a
 * wrong digest look right.
 */
declare module 'node:crypto' {
  export const webcrypto: {
    subtle: {
      digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
    };
  };
}

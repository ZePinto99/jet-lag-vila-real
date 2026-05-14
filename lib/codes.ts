// Game join code generator.
// 4-letter uppercase code over a 23-letter alphabet that excludes visually
// ambiguous characters (I/L/O) and digits (0/1). Random bytes come from
// `crypto.getRandomValues`, available in Node 19+ and Edge runtime.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 4

export function generateGameCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return code
}

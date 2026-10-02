const hasExtension = /\.(?:[cm]?[jt]s|json|node)$/;

export async function resolve(specifier, context, nextResolve) {
  if (!hasExtension.test(specifier) && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // The specifier may be a JavaScript file. Fall through.
    }
  }
  return nextResolve(specifier, context);
}

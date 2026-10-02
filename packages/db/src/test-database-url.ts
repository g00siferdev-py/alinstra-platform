export function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

export function assertResetAllowed(databaseName: string): void {
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing to reset database "${databaseName}". Test databases must end in _test.`);
  }
}

export function testDatabaseUrl(databaseUrl: string, override?: string): string {
  const chosen = override && override.length > 0 ? override : databaseUrl;
  const parsed = new URL(chosen);
  const name = databaseNameFromUrl(chosen);
  if (!name.endsWith("_test")) parsed.pathname = `/${name}_test`;
  return parsed.toString();
}

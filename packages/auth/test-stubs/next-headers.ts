/** Test stub so better-auth nextCookies can write session cookies without installing Next. */
const sets: Array<{ name: string; value: string }> = [];

export function __cookieSets(): Array<{ name: string; value: string }> {
  return sets;
}

export function __clearCookieSets(): void {
  sets.length = 0;
}

export async function headers(): Promise<Headers> {
  return new Headers({ "x-real-ip": "127.0.0.1" });
}

export async function cookies(): Promise<{
  set: (name: string, value: string) => void;
  get: () => undefined;
  getAll: () => [];
}> {
  return {
    set(name: string, value: string) {
      sets.push({ name, value: String(value) });
    },
    get() {
      return undefined;
    },
    getAll() {
      return [];
    },
  };
}
